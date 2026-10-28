// Topics: every morning at 10:00 IST the dashboard researches two lists.
//  - News from the last 24 hours that matters to our company, our services, our clients (Indian
//    founders with US companies, NRIs) or our niche (US-India tax, finance and compliance). Each
//    item has its source and publish time; anything older than about a day is dropped, never shown.
//    A day with no such news shows none, never yesterday's.
//  - Evergreen topics: subjects that stay useful, from the strategy keywords, not yet on the site.
// From a topic a person can have the dashboard write a blog or a LinkedIn article, or upload their
// own piece for an audit, a comparison with the research, and a finalized version.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { parseJson } from './strategy/generate';
import { startTimer, endTimer } from './jobTimer';
import { onceADay, waitsForAi } from './onceADay';
import { runBlogJob } from './blogJob';
import { startAudit, startRewrite } from './auditJobs';
import { plainText, words } from './originality';

export const TOPICS_HOUR_IST = 10;
export const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
export const istHour = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).getUTCHours();

const g = globalThis as unknown as { __topicsRun?: boolean };

export type Relevance = { forUs: string; useful: string; verdict: 'write' | 'maybe' | 'skip'; reason: string };
export type Topic = { title: string; why: string; relevance: Relevance | null; keywords: string[]; sources: { title: string; url: string }[]; kind: 'news' | 'evergreen'; publishedAt: string | null };

// News must be from the last day (a few hours of slack for time zones and late indexing).
export const NEWS_MAX_AGE_HOURS = 30;

const SYSTEM = `You are the content research lead for USAIndiaCFO (usaindiacfo.com), a cross-border finance, tax and compliance firm serving Indian founders with US companies and NRIs. Each morning you find (1) what happened in the LAST 24 HOURS that this firm should write about, and (2) evergreen topics that stay useful. News means: rule, law, deadline or policy changes, official notices, court rulings, budget or tax announcements, and business events from IRS, Treasury, CBDT, RBI, FEMA, MCA, SEBI, SEC, US states, GST Council, DTAA partners, US and Indian immigration for founders, plus anything that changes how Indian founders, NRIs or US-India businesses must act. Use web search and open the pages. Only report an item if the page shows it was published in the last 24 hours, and give that publish time. Never invent news, dates or URLs. If nothing relevant was published in the last 24 hours, return no news; never fill the list with older items.`;

// Why the topic matters to us and whether it is worth writing, for the person deciding.
function cleanRelevance(r: any): Relevance | null {
  if (!r || typeof r !== 'object') return null;
  const str = (v: any) => String(v || '').trim().slice(0, 500);
  const verdict = ['write', 'maybe', 'skip'].includes(r.verdict) ? r.verdict : 'maybe';
  const out = { forUs: str(r.forUs), useful: str(r.useful), verdict, reason: str(r.reason) };
  return out.forUs || out.useful || out.reason ? out : null;
}

function cleanTopic(t: any, kind: 'news' | 'evergreen'): Topic | null {
  if (!t || !t.title) return null;
  const sources = (Array.isArray(t.sources) ? t.sources : []).map((s: any) => (typeof s === 'string' ? { title: s, url: s } : { title: String(s.title || s.url || ''), url: String(s.url || '') })).filter((s: any) => /^https?:\/\//.test(s.url)).slice(0, 4);
  const at = t.publishedAt ? Date.parse(t.publishedAt) : NaN;
  return {
    title: String(t.title).trim().slice(0, 160),
    why: String(t.why || t.reason || '').trim().slice(0, 600),
    relevance: cleanRelevance(t.relevance),
    keywords: (Array.isArray(t.keywords) ? t.keywords : String(t.keywords || '').split(',')).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8),
    sources,
    kind,
    publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
  };
}

// Keeps only news with a source and a publish time inside the last NEWS_MAX_AGE_HOURS.
export function freshNews(list: any[], now = new Date()): Topic[] {
  return (Array.isArray(list) ? list : [])
    .map((t) => cleanTopic(t, 'news'))
    .filter((t): t is Topic => Boolean(t && t.sources.length && t.publishedAt))
    .filter((t) => {
      const age = (now.getTime() - Date.parse(t.publishedAt!)) / 3600000;
      return age >= -2 && age <= NEWS_MAX_AGE_HOURS;
    })
    .slice(0, 6);
}

function parseTopics(text: string, now: Date): Topic[] {
  const j: any = parseJson(text);
  const evergreen = (Array.isArray(j.evergreen) ? j.evergreen : []).map((t: any) => cleanTopic(t, 'evergreen')).filter(Boolean).slice(0, 3) as Topic[];
  return [...freshNews(j.news, now), ...evergreen];
}

// The daily research. Returns the topics saved for today. Running it again the same day replaces
// today's topics nobody has started on.
export async function researchTopics(now = new Date(), { force = false } = {}) {
  const day = istDay(now);
  if (g.__topicsRun) return { skipped: 'A topic research is already running.' };
  if (!force && (await prisma.topics.count({ where: { day } }))) return { skipped: 'Already researched today.' };
  g.__topicsRun = true;
  const key = `topics-${day}`;
  startTimer(key, 'keywords', `Topic research for ${day}`);
  try {
    const strategy = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
    const plan = strategy?.plan_json ? JSON.parse(strategy.plan_json) : null;
    const keywords = plan ? [...(plan.keywords || []).map((k: any) => k.keyword), ...(plan.blogPlan?.calendar || []).map((b: any) => b.mainKeyword)].filter(Boolean).slice(0, 60) : [];
    const focus = String((await settings.get('focus_services')) || 'ITIN, EIN, US company formation for Indians, NRI tax, FEMA compliance, virtual CFO').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    const recent = await prisma.drafts.findMany({ where: { status: { in: ['published', 'approved', 'pending_review'] } }, select: { title: true }, orderBy: { id: 'desc' }, take: 40 });
    const earlier = await prisma.topics.findMany({ where: { day: { lt: day } }, orderBy: { id: 'desc' }, take: 60, select: { title: true, day: true } });
    const since = new Date(now.getTime() - 24 * 3600000).toISOString();
    const prompt = `Now: ${now.toISOString()} (India date ${day}). Only news published after ${since} counts.
Services we sell: ${focus.join('; ')}.
Strategy keywords (use them where they fit): ${keywords.join(', ') || 'none approved yet'}.
Titles already on the site or in progress (do not repeat): ${recent.map((r) => r.title).filter(Boolean).join(' | ') || 'none'}.
Topics given on earlier days (never repeat them): ${earlier.map((t) => t.title).join(' | ') || 'none'}.

1. Search the web for news published in the last 24 hours that matters to our company, our services, our clients or our niche. Up to 6 items, each with the page URL and its publish time.
2. Give 3 evergreen topics from the strategy keywords or our services that are not on the site yet.
Return ONLY JSON between ===JSON=== and ===END===:
{"news":[{"title":"...","why":"what happened and why our clients care, one or two sentences","keywords":["primary","secondary"],"sources":[{"title":"...","url":"https://..."}],"publishedAt":"2026-01-31T09:00:00Z","relevance":{"forUs":"which of our services or client groups this touches and how, one or two sentences","useful":"what a reader can do with it: a deadline, a filing, a cost, a risk to plan for","verdict":"write|maybe|skip","reason":"one line: why write it now, or why it is weak (too niche, not our service, already covered, no action for clients)"}}],
 "evergreen":[{"title":"...","why":"why it stays useful for our clients","keywords":["primary","secondary"],"sources":[],"relevance":{"forUs":"which of our services or client groups this touches and how, one or two sentences","useful":"what a reader can do with it: a deadline, a filing, a cost, a risk to plan for","verdict":"write|maybe|skip","reason":"one line: why write it now, or why it is weak (too niche, not our service, already covered, no action for clients)"}}]}
For every item fill "relevance" honestly: "write" only when it touches a service we sell and gives clients something to act on; "skip" when it is only loosely related. Inside string values never use a double quote. If no news qualifies, return "news":[].`;
    const { text } = (await callClaude(SYSTEM, [{ role: 'user', content: prompt }], undefined, { maxUses: Number(process.env.TOPICS_SEARCHES || 15), effort: 'high', feature: 'other' })) as { text: string };
    const topics = parseTopics(text, now);
    // A fresh run replaces today's topics nobody has started on.
    await prisma.topics.deleteMany({ where: { day, status: 'new' } });
    const saved: any[] = [];
    for (const t of topics) saved.push(await prisma.topics.create({ data: { day, title: t.title, why: t.why, keywords: JSON.stringify(t.keywords), sources: JSON.stringify(t.sources), relevance: t.relevance ? JSON.stringify(t.relevance) : null, kind: t.kind, published_at: t.publishedAt } }));
    const news = saved.filter((t) => t.kind === 'news').length;
    const note = news ? null : 'No news from the last 24 hours fits our company, services or clients.';
    await settings.set('topics_last_run', JSON.stringify({ at: new Date().toISOString(), day, count: saved.length, news, note }));
    await activity.log('topics.researched', { details: `${news} news topic(s) from the last 24 hours and ${saved.length - news} evergreen for ${day}` });
    await endTimer(key, true);
    return { day, topics: saved, note };
  } catch (e: any) {
    await settings.set('topics_last_run', JSON.stringify({ at: new Date().toISOString(), day, error: String(e?.message || e).slice(0, 300) }));
    // Waiting for AI (Testing mode, a credit pause) is not a failure: the run is tried again on later
    // ticks that day, and a failure row on each of them would only be noise.
    if (!waitsForAi(e)) await activity.log('topics.failed', { details: String(e?.message || e).slice(0, 200) });
    await endTimer(key, false);
    throw e;
  } finally {
    g.__topicsRun = false;
  }
}

// Called from the scheduler every 15 minutes: runs once a day after 10:00 IST.
export async function topicsTick(now = new Date()) {
  if (istHour(now) < TOPICS_HOUR_IST) return;
  const day = istDay(now);
  // The day counts as done when the research ends; one stopped by paused AI work runs again later.
  await onceADay('topics_last_day', day, () => researchTopics(now)).catch((e) => console.error('Topics research failed:', e.message));
}

// For a topic researched before the relevance note existed: why it matters to us, written on
// request (one short call, no web search), and saved on the topic.
export async function explainRelevance(id: number) {
  const t: any = await prisma.topics.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error('Topic not found'), { status: 404 });
  if (t.relevance) return { relevance: JSON.parse(t.relevance) };
  const focus = String((await settings.get('focus_services')) || 'ITIN, EIN, US company formation for Indians, NRI tax, FEMA compliance, virtual CFO').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  const { text } = (await callClaude(
    `${SYSTEM}\nNow you judge one topic already found. Be honest: say "skip" when it is only loosely related. Return ONLY JSON between ===JSON=== and ===END===.`,
    [{ role: 'user', content: `Services we sell: ${focus.join('; ')}.\nTopic: ${t.title}\nWhat happened: ${t.why || ''}\nSources: ${JSON.parse(t.sources || '[]').map((x: any) => `${x.title} ${x.url}`).join(' | ')}\n\nReturn {"forUs":"which of our services or client groups this touches and how, one or two sentences","useful":"what a reader can do with it: a deadline, a filing, a cost, a risk to plan for","verdict":"write|maybe|skip","reason":"one line: why write it now, or why it is weak"}. Inside string values never use a double quote.` }],
    undefined,
    { maxUses: 0, effort: 'medium', feature: 'other' }
  )) as { text: string };
  let r: Relevance | null = null;
  try {
    r = cleanRelevance(parseJson(text));
  } catch {}
  if (!r) throw new Error('The answer could not be read. Try again.');
  await prisma.topics.update({ where: { id }, data: { relevance: JSON.stringify(r) } });
  return { relevance: r };
}

const topicNotes = (t: any) => `Topic from the daily research (${t.day}): ${t.title}. Why now: ${t.why || ''}. Keywords to use: ${JSON.parse(t.keywords || '[]').join(', ')}. Sources: ${JSON.parse(t.sources || '[]').map((s: any) => s.url).join(', ')}.`;

// Writes a blog for the topic with the normal blog pipeline (research, fact check, review).
export async function startTopicBlog(id: number) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error('Topic not found'), { status: 404 });
  if (t.draft_id) throw Object.assign(new Error('A blog for this topic was already started.'), { status: 409 });
  if (t.status === 'blog') throw Object.assign(new Error('A blog for this topic is being written.'), { status: 409 });
  const kws: string[] = JSON.parse(t.keywords || '[]');
  const kw = await prisma.keywords.create({ data: { keyword: kws[0] || t.title.toLowerCase().slice(0, 80), batch_name: 'Topics', notes: topicNotes(t), status: 'generating' } });
  await prisma.topics.update({ where: { id }, data: { status: 'blog' } });
  const controller = new AbortController();
  void runBlogJob(kw, controller).then(async () => {
    const d = await prisma.drafts.findFirst({ where: { keyword_id: kw.id }, orderBy: { id: 'desc' }, select: { id: true } });
    if (d) await prisma.topics.update({ where: { id }, data: { draft_id: d.id } });
  }).catch(() => {});
  return { keywordId: kw.id };
}

// Topics whose blog run ended without the in-memory link above (a restart, a resumed run): the draft
// is found through the topic's keyword (same notes) and linked. A run that failed, or whose draft was
// deleted before it was linked, puts the topic back to 'new', so "Write blog" can be pressed again. Returns the topics that changed.
export async function linkTopicBlogs(rows: any[]) {
  const changed = new Map<number, any>();
  for (const t of rows.filter((r) => r.status === 'blog' && !r.draft_id)) {
    const kw = await prisma.keywords.findFirst({ where: { batch_name: 'Topics', notes: topicNotes(t) }, orderBy: { id: 'desc' }, select: { id: true, status: true } });
    if (!kw) continue;
    const d = await prisma.drafts.findFirst({ where: { keyword_id: kw.id }, orderBy: { id: 'desc' }, select: { id: true } });
    if (d) changed.set(t.id, await prisma.topics.update({ where: { id: t.id }, data: { draft_id: d.id } }));
    // No draft: the run failed, or it finished ('drafted') and its draft was deleted before it was linked.
    else if (kw.status === 'failed' || kw.status === 'drafted') changed.set(t.id, await prisma.topics.update({ where: { id: t.id }, data: { status: 'new' } }));
  }
  return changed;
}

// Writes a LinkedIn article for the topic in the background.
export async function startTopicArticle(id: number) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error('Topic not found'), { status: 404 });
  if (t.article_draft_id) throw Object.assign(new Error('An article for this topic was already started.'), { status: 409 });
  const { writeArticle } = await import('./articleWriter');
  const kws: string[] = JSON.parse(t.keywords || '[]');
  const kw = await prisma.keywords.create({ data: { keyword: kws[0] || t.title.toLowerCase().slice(0, 80), batch_name: 'LinkedIn articles', notes: topicNotes(t), status: 'drafted' } });
  await prisma.topics.update({ where: { id }, data: { status: 'article' } });
  void writeArticle({ topic: t, keywordId: kw.id })
    .then((draftId) => prisma.topics.update({ where: { id }, data: { article_draft_id: draftId } }))
    .catch(() => {});
  return { keywordId: kw.id };
}

// A piece someone wrote themselves: audited with the topic's research in mind.
export async function attachManual(id: number, { title, contentHtml, actor }: { title: string; contentHtml: string; actor?: string | null }) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error('Topic not found'), { status: 404 });
  const audit = await startAudit({ title: title || t.title, contentHtml, actor });
  await prisma.topics.update({ where: { id }, data: { status: 'manual', audit_id: audit.id, comparison: null } });
  return audit;
}

// Genuine comparison of the uploaded piece with the research: keywords actually used (counted in
// the text), and the points the research says the piece should cover, judged by Claude without
// web search (the audit already checked the facts).
export async function compareManual(id: number) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t?.audit_id) throw Object.assign(new Error('Upload the piece first.'), { status: 400 });
  const audit = await prisma.blog_audits.findUnique({ where: { id: t.audit_id } });
  if (!audit?.content_html) throw Object.assign(new Error('The audit has no content.'), { status: 400 });
  if (audit.audit_status === 'running') throw Object.assign(new Error('The audit is still running; compare once it has finished.'), { status: 409 });
  const text = plainText(audit.content_html);
  const ws = words(text);
  const joined = ws.join(' ');
  const kws: string[] = JSON.parse(t.keywords || '[]');
  const keywordUse = kws.map((k) => ({ keyword: k, count: joined.split(words(k).join(' ')).length - 1 }));
  const { text: reply } = (await callClaude(
    'You compare a draft written by a person with a research brief, for a cross-border finance firm. Be concrete and fair: quote the draft where it covers a point; say plainly what is missing or weaker than the brief; never praise vaguely. Return ONLY JSON between ===JSON=== and ===END===.',
    [
      {
        role: 'user',
        content: `RESEARCH BRIEF\nTopic: ${t.title}\nWhy now: ${t.why}\nKeywords: ${kws.join(', ')}\nSources: ${JSON.parse(t.sources || '[]').map((s: any) => `${s.title} ${s.url}`).join(' | ')}\n\nAUDIT FINDINGS ON THE DRAFT\nVerdict: ${audit.verdict}. ${audit.summary || ''}\nIssues: ${JSON.parse(audit.issues || '[]').map((i: any) => i.description || i).join(' | ')}\n\nTHE DRAFT (plain text, ${ws.length} words)\n${text.slice(0, 16000)}\n\nReturn {"covered":[{"point":"...","where":"short quote from the draft"}],"missing":[{"point":"...","why":"why it matters, from the brief or sources"}],"weaker":[{"point":"...","fix":"what to change"}],"verdict":"ready|needs work","summary":"two sentences"}`,
      },
    ],
    undefined,
    { maxUses: 0, effort: 'high', feature: 'audit' }
  )) as { text: string };
  let j: any = {};
  try {
    j = parseJson(reply);
  } catch {
    j = { verdict: 'needs work', summary: 'The comparison could not be read. Try again.', covered: [], missing: [], weaker: [] };
  }
  const comparison = { ...j, keywordUse, words: ws.length, checkedAt: new Date().toISOString() };
  await prisma.topics.update({ where: { id }, data: { comparison: JSON.stringify(comparison) } });
  return comparison;
}

// The finalized version: the audit's rewrite, with the comparison's gaps and the reviewer's
// comments added to what it must fix.
export async function finalizeManual(id: number, comments: string, actor?: string | null) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t?.audit_id) throw Object.assign(new Error('Upload the piece first.'), { status: 400 });
  const audit = await prisma.blog_audits.findUnique({ where: { id: t.audit_id } });
  if (!audit) throw Object.assign(new Error('Audit not found'), { status: 404 });
  const cmp = t.comparison ? JSON.parse(t.comparison) : null;
  const extra: string[] = [];
  for (const m of cmp?.missing || []) extra.push(`Add: ${m.point}. ${m.why || ''}`.trim());
  for (const w of cmp?.weaker || []) extra.push(`Strengthen: ${w.point}. ${w.fix || ''}`.trim());
  for (const k of (cmp?.keywordUse || []).filter((k: any) => !k.count)) extra.push(`Use the keyword "${k.keyword}" naturally (title, a heading or the first paragraphs).`);
  if (comments.trim()) extra.push(`Reviewer comments (follow them exactly): ${comments.trim()}`);
  const suggestions = [...JSON.parse(audit.suggestions || '[]'), ...extra];
  await prisma.blog_audits.update({ where: { id: audit.id }, data: { suggestions: JSON.stringify(suggestions) } });
  return startRewrite(audit.id, actor);
}

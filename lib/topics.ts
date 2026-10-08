// Topics: every morning at 10:00 IST the dashboard researches what is worth writing about today
// (news, rule changes, deadlines, and the approved strategy's keywords) and lists up to five
// topics with the keywords to use and the sources. Nothing new that day: yesterday's topics are
// carried over with a note saying so. From a topic a person can have the dashboard write a blog
// or a LinkedIn article, or upload their own piece for an audit, a comparison with the research,
// and a finalized version.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { parseJson } from './strategy/generate';
import { startTimer, endTimer } from './jobTimer';
import { runBlogJob } from './blogJob';
import { startAudit, startRewrite } from './auditJobs';
import { plainText, words } from './originality';

export const TOPICS_HOUR_IST = 10;
export const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
export const istHour = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).getUTCHours();

const g = globalThis as unknown as { __topicsRun?: boolean };

export type Topic = { title: string; why: string; keywords: string[]; sources: { title: string; url: string }[]; kind: 'news' | 'update' | 'evergreen' };

const SYSTEM = `You are the content research lead for USAIndiaCFO (usaindiacfo.com), a cross-border finance, tax and compliance firm serving Indian founders with US companies and NRIs. Each morning you find what is worth writing about TODAY for this audience: fresh news, rule or deadline changes (IRS, CBDT, RBI, FEMA, MCA, SEC, state filings, GST, DTAA, visas for founders), and any update that affects US-India businesses. Use web search for the last 48 hours first; then add at most two evergreen topics from the strategy keywords that are not yet covered on the site. Be specific and verifiable: a topic must come from a real, current source you found, with its URL. Never invent news. Prefer topics where a 1,200 to 1,800 word blog could rank and a LinkedIn article could start a conversation.`;

function parseTopics(text: string): Topic[] {
  const j: any = parseJson(text);
  const list = Array.isArray(j) ? j : j.topics || [];
  return list
    .filter((t: any) => t && t.title)
    .slice(0, 5)
    .map((t: any) => ({
      title: String(t.title).trim().slice(0, 160),
      why: String(t.why || t.reason || '').trim().slice(0, 600),
      keywords: (Array.isArray(t.keywords) ? t.keywords : String(t.keywords || '').split(',')).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8),
      sources: (Array.isArray(t.sources) ? t.sources : []).map((s: any) => (typeof s === 'string' ? { title: s, url: s } : { title: String(s.title || s.url || ''), url: String(s.url || '') })).filter((s: any) => /^https?:\/\//.test(s.url)).slice(0, 4),
      kind: ['news', 'update', 'evergreen'].includes(t.kind) ? t.kind : 'news',
    }));
}

// The daily research. Returns the topics saved for today.
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
    const yesterday = await prisma.topics.findMany({ where: { day: { lt: day } }, orderBy: { id: 'desc' }, take: 10, select: { title: true, day: true } });
    const prompt = `Today is ${day} (India). Services we sell: ${focus.join('; ')}.
Strategy keywords (use them where they fit): ${keywords.join(', ') || 'none approved yet'}.
Titles already on the site or in progress (do not repeat these topics): ${recent.map((r) => r.title).filter(Boolean).join(' | ') || 'none'}.
Topics suggested on earlier days (do not repeat unless there is genuinely new news): ${yesterday.map((t) => `${t.day}: ${t.title}`).join(' | ') || 'none'}.

Search the web for news and updates from the last 48 hours that matter to this audience. Then return ONLY JSON between ===JSON=== and ===END=== in this shape:
{"topics":[{"title":"...","why":"one or two sentences: what happened or changed, and why our audience cares now","keywords":["primary keyword","secondary","..."],"sources":[{"title":"...","url":"https://..."}],"kind":"news|update|evergreen"}]}
Rules: 0 to 5 topics. At most 2 evergreen. Every news or update topic needs at least one source URL from your search. If nothing relevant happened, return {"topics":[]}.`;
    const { text } = (await callClaude(SYSTEM, [{ role: 'user', content: prompt }], undefined, { maxUses: Number(process.env.TOPICS_SEARCHES || 12), effort: 'high', feature: 'other' })) as { text: string };
    let topics: Topic[] = [];
    try {
      topics = parseTopics(text);
    } catch {
      topics = [];
    }
    let note: string | null = null;
    if (!topics.length) {
      // Carry yesterday's topics over, saying why.
      const lastDay = (await prisma.topics.findFirst({ where: { day: { lt: day } }, orderBy: { day: 'desc' }, select: { day: true } }))?.day;
      const prev = lastDay ? await prisma.topics.findMany({ where: { day: lastDay }, orderBy: { id: 'asc' } }) : [];
      note = `No new news or updates for our audience were found this morning, so the topics from ${lastDay || 'the last run'} are carried over.`;
      topics = prev.map((t) => ({ title: t.title, why: t.why || '', keywords: JSON.parse(t.keywords || '[]'), sources: JSON.parse(t.sources || '[]'), kind: (t.kind as any) || 'evergreen' }));
    }
    const saved: any[] = [];
    for (const t of topics) saved.push(await prisma.topics.create({ data: { day, title: t.title, why: t.why, keywords: JSON.stringify(t.keywords), sources: JSON.stringify(t.sources), kind: t.kind, carried_over: note } }));
    await settings.set('topics_last_run', JSON.stringify({ at: new Date().toISOString(), day, count: saved.length, note }));
    await activity.log('topics.researched', { details: `${saved.length} topic(s) for ${day}${note ? ' (carried over: nothing new found)' : ''}` });
    await endTimer(key, true);
    return { day, topics: saved, note };
  } catch (e: any) {
    await settings.set('topics_last_run', JSON.stringify({ at: new Date().toISOString(), day, error: String(e?.message || e).slice(0, 300) }));
    await activity.log('topics.failed', { details: String(e?.message || e).slice(0, 200) });
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
  if ((await settings.get('topics_last_day')) === day) return;
  await settings.set('topics_last_day', day);
  await researchTopics(now).catch((e) => console.error('Topics research failed:', e.message));
}

const topicNotes = (t: any) => `Topic from the daily research (${t.day}): ${t.title}. Why now: ${t.why || ''}. Keywords to use: ${JSON.parse(t.keywords || '[]').join(', ')}. Sources: ${JSON.parse(t.sources || '[]').map((s: any) => s.url).join(', ')}.`;

// Writes a blog for the topic with the normal blog pipeline (research, fact check, review).
export async function startTopicBlog(id: number) {
  const t = await prisma.topics.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error('Topic not found'), { status: 404 });
  if (t.draft_id) throw Object.assign(new Error('A blog for this topic was already started.'), { status: 409 });
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

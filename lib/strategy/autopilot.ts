// @ts-nocheck -- orchestration over untyped integration modules.
// Runs the approved month automatically: drafts blogs ahead of their slot, opens the 24-hour review
// window, auto-approves and publishes on schedule behind the automatic fact check and writing rules,
// does the after-publish steps, checks ranks daily and compares plan vs actual weekly.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { researchAndWriteBlog, verifyAndCorrect } from '../anthropic';
import { publishPost, updatePost, seoSlug, wpRequest, uploadFeaturedImage } from '../wordpress';
import { listSites, getSiteRankings, addTrackedKeyword } from '../seranking';
import { getTermsForKeyword } from '../surfer';
import { submitIndexNow, resubmitSitemap } from '../indexing';
import { notify } from '../notify';
import * as settings from '../settings';
import { progressWriter } from './jobs';
import { gatherAiVisibility } from '../aiVisibility';
import { syncMeetings } from '../clientInsights';
import { runFixes } from './fixer';
import { runOutreach } from './outreach';
import { scheduleAction, extractClaims, writingRuleIssues, faqSchema, keywordKey, crawlIsFresh } from './core';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const HOST = () => SITE().replace(/^https?:\/\//, '').replace(/^www\./, '');
const DRAFT_LEAD_HOURS = 48;

const update = (id, data) => prisma.blog_schedule.update({ where: { id }, data: { ...data, updated_at: sqlNow() } });

// Writes the draft for one calendar row (the same pipeline as the Keywords tab).
async function writeDraft(row) {
  await update(row.id, { status: 'drafting' });
  const kw = await prisma.keywords.create({
    data: { batch_name: `Strategy #${row.strategy_id}`, keyword: row.main_keyword, notes: `Planned title: ${row.title}. Channels: ${JSON.parse(row.tags).join(', ')}.${row.refresh_url ? ` Refresh of ${row.refresh_url}.` : ''}`, status: 'generating' },
  });
  const onProgress = progressWriter((stage, percent) => prisma.keywords.update({ where: { id: kw.id }, data: { progress_stage: stage, progress_percent: percent } }));
  let result;
  try {
    result = await researchAndWriteBlog(row.main_keyword, kw.notes, { onProgress });
  } catch (err: any) {
    // Never leave the keyword stuck as "generating"; the next scheduler run tries again.
    await prisma.keywords.update({ where: { id: kw.id }, data: { status: 'failed', error: String(err.message || err).slice(0, 1000), progress_stage: null, progress_percent: null } });
    await update(row.id, { status: 'planned' });
    throw err;
  }
  const draft = await prisma.drafts.create({
    data: {
      keyword_id: kw.id,
      title: result.title,
      meta_description: result.meta,
      content_html: result.content,
      research_notes: `${result.researchNotes || ''}${result.factCheck ? `\n\nIndependent fact check (${result.factCheck.model}): ${result.factCheck.checks.length} claims, ${result.factCheck.checks.filter((c) => c.verdict === 'correct').length} confirmed.` : ''}`,
      production_state: result.productionState,
      repair_attempts: result.repairAttempts,
      validation_issues: JSON.stringify(result.validation.issues),
      validation_warnings: JSON.stringify(result.validation.warnings || []),
      word_count: result.validation.wordCount,
      people_also_ask: JSON.stringify(result.peopleAlsoAsk || []),
      keyword_plan: JSON.stringify(result.keywordPlan || null),
      status: 'pending_review',
      target_wp_post_id: null,
    },
  });
  for (const f of result.facts) {
    await prisma.facts.create({ data: { draft_id: draft.id, fact_id: f.fact_id, claim: f.claim, source_name: f.source_name, source_url: f.source_url, jurisdiction: f.jurisdiction, effective_date: f.effective_date } });
  }
  await prisma.keywords.update({ where: { id: kw.id }, data: { status: 'drafted', progress_stage: null, progress_percent: null } });
  await update(row.id, { keyword_id: kw.id, draft_id: draft.id, status: 'planned' });
  await activity.log('schedule.drafted', { entityType: 'draft', entityId: draft.id, details: `"${result.title}" for ${row.publish_at} UTC` });
  return draft;
}

// Auto-publishing pauses when the latest crawl shows server errors or the site is not reachable.
async function publishingPaused() {
  const crawl = await prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });
  if (crawl && crawlIsFresh(crawl.created_at)) {
    const problems = JSON.parse(crawl.problem_urls || '[]');
    const serverErrors = problems.filter((p) => (p.issues || []).some((i) => /^5\d\d status/.test(i))).length;
    if (serverErrors > 0) return `latest crawl has ${serverErrors} URL(s) with 5xx server errors`;
  }
  try {
    const res = await fetch(`${SITE()}/robots.txt`, { signal: AbortSignal.timeout(15000) });
    if (res.status >= 500) return `site returned ${res.status}`;
    const txt = await res.text();
    if (/^\s*disallow:\s*\/\s*$/im.test(txt.split(/user-agent:\s*\*/i)[1]?.split(/user-agent:/i)[0] || '')) return 'robots.txt blocks all crawlers';
  } catch (e: any) {
    return `site not reachable (${e.message})`;
  }
  return null;
}

async function surferScore(keyword, html) {
  // Surfer's content score comes from its Content Editor; when the API cannot return one the
  // check is reported as missing rather than guessed.
  try {
    const terms = await getTermsForKeyword(keyword, { maxWaitMs: 60000 });
    const list = (terms?.terms || terms || []).map((t) => String(t.term || t.phrase || t).toLowerCase()).filter(Boolean);
    if (!list.length) return null;
    const text = html.replace(/<[^>]+>/g, ' ').toLowerCase();
    return Math.round((list.filter((t) => text.includes(t)).length / list.length) * 100);
  } catch {
    return null;
  }
}

// Adds a link to the new post from 2 to 3 older related posts.
async function addInternalLinks(newUrl, title, keyword) {
  const words = keyword.split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(' ');
  const { json: posts } = await wpRequest('GET', '/wp/v2/posts', { query: { search: words || keyword, per_page: 6, context: 'edit', _fields: 'id,link,content' } });
  const done = [];
  for (const p of (posts || []).filter((x) => x.link !== newUrl).slice(0, 3)) {
    const raw = p.content?.raw || '';
    if (!raw || raw.includes(newUrl)) continue;
    const add = `\n<p>Related guide: <a href="${newUrl}">${title}</a></p>\n`;
    const idx = raw.search(/<h2[^>]*>\s*(frequently asked questions|faqs?)/i);
    await updatePost(p.id, { contentHtml: idx > 0 ? raw.slice(0, idx) + add + raw.slice(idx) : raw + add });
    done.push(p.link);
  }
  return done;
}

// Automatic fact check, run on every new version of a draft: checks every claim against primary
// sources, corrects what is wrong, and repeats until two checks in a row are clean. The corrected
// draft is saved. A draft that cannot be fully verified is never published.
// `verify` is injectable for tests.
async function ensureFactChecked(row, draft, verify = verifyAndCorrect) {
  const prev = row.fact_check ? JSON.parse(row.fact_check) : null;
  if (prev && prev.stamp === draft.updated_at) return { ...prev, draft };
  const facts = await prisma.facts.findMany({ where: { draft_id: draft.id }, select: { fact_id: true, claim: true, source_url: true } });
  const result = await verify(
    { title: draft.title, meta: draft.meta_description, content: draft.content_html || '', facts },
    { mustCheckOf: (html) => extractClaims(html).map((c) => c.sentence) }
  );
  let saved = draft;
  const changed = result.draft.content !== draft.content_html || result.draft.title !== draft.title || result.draft.meta !== draft.meta_description;
  if (changed) {
    saved = await prisma.drafts.update({
      where: { id: draft.id },
      data: { title: result.draft.title, meta_description: result.draft.meta, content_html: result.draft.content, updated_at: sqlNow() },
    });
  }
  const record = { stamp: saved.updated_at, ok: result.ok, rounds: result.rounds, corrected: changed, log: result.log, checkedAt: sqlNow() };
  await update(row.id, { fact_check: JSON.stringify(record) });
  await activity.log('schedule.fact_checked', {
    entityType: 'draft',
    entityId: draft.id,
    details: `"${saved.title}": ${result.ok ? 'verified' : 'NOT verified'} after ${result.rounds} round(s)${changed ? ', corrections applied' : ''}`,
  });
  return { ...record, draft: saved };
}

async function publishRow(row, now, verify = verifyAndCorrect) {
  const draft = row.draft_id ? await prisma.drafts.findUnique({ where: { id: row.draft_id } }) : null;
  if (!draft) {
    await update(row.id, { status: 'held', hold_reasons: JSON.stringify(['No draft was written in time.']) });
    await notify(`Blog held: ${row.title}`, 'No draft was ready at the publish slot.');
    return 'held';
  }
  const reasons = [];
  const paused = await publishingPaused();
  if (paused) reasons.push(`Auto-publishing paused: ${paused}.`);
  if (draft.status === 'rejected') reasons.push('Reviewer rejected the draft.');
  const fc = await ensureFactChecked(row, draft, verify);
  const checked = fc.draft;
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(checked.content_html || '')) reasons.push('Draft still has a reviewer placeholder.');
  if (!fc.ok) reasons.push(`Fact check could not confirm every claim from a primary source after ${fc.rounds} rounds. Not published.`);
  const score = await surferScore(row.main_keyword, checked.content_html || '');
  for (const i of writingRuleIssues({ title: checked.title, meta: checked.meta_description, html: checked.content_html || '', surferScore: score, siteHost: HOST() })) reasons.push(i);
  if (reasons.length) {
    const first = row.status !== 'held';
    await update(row.id, { status: 'held', hold_reasons: JSON.stringify(reasons) });
    if (first) await notify(`Blog held: ${row.title}`, reasons.join('\n'));
    return 'held';
  }

  // Reviewed = marked reviewed, approved in Drafts & Review, or edited by a person after review opened
  // (the fact checker's own corrections do not count as a review).
  const reviewed = Boolean(row.reviewed_at) || draft.status === 'approved' || Boolean(row.review_started && draft.updated_at > row.review_started && draft.updated_at !== (row.fact_check ? JSON.parse(row.fact_check).stamp : null));
  const html = `${checked.content_html}\n${faqSchema(checked.content_html) || ''}`;
  let post;
  if (row.refresh_url) {
    const { json: found } = await wpRequest('GET', '/wp/v2/posts', { query: { slug: new URL(row.refresh_url).pathname.split('/').filter(Boolean).pop(), _fields: 'id,link' } });
    if (!found?.[0]) throw new Error(`Refresh target not found: ${row.refresh_url}`);
    post = await updatePost(found[0].id, { title: checked.title, contentHtml: html, excerpt: checked.meta_description, metaDescription: checked.meta_description, focusKeyphrase: row.main_keyword, status: 'publish' });
  } else {
    const featuredMediaId = checked.featured_image_path ? await uploadFeaturedImage(checked.featured_image_path).catch(() => undefined) : undefined;
    post = await publishPost({ title: checked.title, contentHtml: html, excerpt: checked.meta_description, featuredMediaId, status: 'publish', slug: seoSlug(row.main_keyword), metaDescription: checked.meta_description, focusKeyphrase: row.main_keyword });
  }
  await prisma.drafts.update({ where: { id: checked.id }, data: { status: 'published', wp_post_id: post.id, wp_post_url: post.link, updated_at: sqlNow() } });

  // After publish: each step is independent and its result is logged.
  const log: any = {};
  const step = async (name, fn) => {
    try {
      log[name] = { ok: true, result: await fn() };
    } catch (e: any) {
      log[name] = { ok: false, error: e.message };
    }
  };
  await step('indexNow', () => submitIndexNow([post.link]));
  await step('searchConsoleSitemap', () => resubmitSitemap());
  await step('seRankingTracking', () => addTrackedKeyword(row.main_keyword));
  await step('internalLinks', () => addInternalLinks(post.link, checked.title, row.main_keyword));

  await update(row.id, { status: 'published', approval_mode: reviewed ? 'reviewed' : 'auto', wp_post_url: post.link, post_publish_log: JSON.stringify(log), hold_reasons: null });
  await activity.log('schedule.published', { entityType: 'draft', entityId: checked.id, details: `"${checked.title}" ${reviewed ? 'reviewed version' : 'auto-approved after 24 hours'}: ${post.link}` });
  return 'published';
}

// One server process runs the jobs, so an in-memory flag stops a scheduled call from overlapping a
// run that is still writing a long maximum-effort draft.
let running = false;

// The scheduler job. Meant to run every 15 minutes; every step is idempotent.
export async function runDaily(now = new Date(), opts: { maxDrafts?: number; verify?: any } = {}) {
  if (running) return { skipped: 'A previous run is still in progress.' };
  running = true;
  try {
    return await runDailyOnce(now, opts);
  } finally {
    running = false;
  }
}

async function runDailyOnce(now: Date, { maxDrafts = 1, verify = verifyAndCorrect }: { maxDrafts?: number; verify?: any }) {
  const summary: any = { opened: 0, published: 0, held: 0, drafted: 0, errors: [] };
  const rows = await prisma.blog_schedule.findMany({ where: { status: { in: ['planned', 'drafting', 'in_review', 'held'] } }, orderBy: { publish_at: 'asc' } });

  for (const row of rows) {
    const action = scheduleAction(row, now);
    try {
      if (action === 'open_review') {
        if (!row.draft_id && summary.drafted < maxDrafts) {
          await writeDraft(row);
          summary.drafted++;
        }
        const fresh = await prisma.blog_schedule.findUnique({ where: { id: row.id } });
        if (fresh.draft_id) {
          // Fact-check before reviewers see it, so they review the corrected version.
          const d = await prisma.drafts.findUnique({ where: { id: fresh.draft_id } });
          if (d) await ensureFactChecked(fresh, d, verify);
          await update(row.id, { status: 'in_review', review_started: sqlNow(now) });
          await notify(`Blog ready for review: ${row.title}`, `Review and edit it in Drafts & Review within 24 hours. If nobody reviews it, it is auto-approved and published at ${row.publish_at} UTC.`);
          summary.opened++;
        }
      } else if (action === 'publish') {
        const r = await publishRow(row, now, verify);
        summary[r]++;
      } else if (!row.draft_id && row.status === 'planned' && Date.parse(row.publish_at.replace(' ', 'T') + 'Z') - now.getTime() <= DRAFT_LEAD_HOURS * 3600000 && summary.drafted < maxDrafts) {
        await writeDraft(row);
        summary.drafted++;
      }
    } catch (e: any) {
      summary.errors.push(`${row.title}: ${e.message}`);
      await activity.log('schedule.failed', { details: `${row.title}: ${e.message}` });
    }
  }

  // Rank check once per day, even though the job runs every 15 minutes.
  const today = now.toISOString().slice(0, 10);
  if ((await settings.get('last_rank_check')) !== today) {
    summary.rankAlerts = await dailyRankCheck(now).catch((e) => ({ error: e.message }));
    if (!summary.rankAlerts?.error) await settings.set('last_rank_check', today);
  }
  // Technical fixes ticked in the approved strategy: a few per run.
  summary.fixes = await runFixes().catch((e) => ({ error: e.message }));
  // Backlink outreach (leads pushed to Smartlead) and link check, once per day.
  if ((await settings.get('last_outreach_run')) !== today) {
    summary.outreach = await runOutreach(now).catch((e) => ({ error: e.message }));
    if (!summary.outreach?.error) await settings.set('last_outreach_run', today);
  }
  // Fireflies meetings: pull new ones and auto-review them, once per day.
  if (process.env.FIREFLIES_API_KEY && (await settings.get('last_meeting_sync')) !== today) {
    summary.meetings = await syncMeetings().catch((e) => ({ error: e.message }));
    if (!summary.meetings?.error) await settings.set('last_meeting_sync', today);
  }
  return summary;
}

// Priority keywords: the approved strategy's keyword table and blog main keywords.
async function priorityKeywords() {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return new Set();
  const plan = JSON.parse(s.plan_json);
  return new Set([...(plan.keywords || []).map((k) => keywordKey(k.keyword)), ...(plan.blogPlan?.calendar || []).map((b) => keywordKey(b.mainKeyword))]);
}

export async function dailyRankCheck(now = new Date()) {
  const sites = await listSites();
  if (!sites.length) return { checked: 0, alerts: [] };
  const rows = await getSiteRankings(sites[0].id);
  const priority = await priorityKeywords();
  const today = now.toISOString().slice(0, 10);
  const alerts = [];
  for (const r of rows.filter((x) => priority.has(keywordKey(x.keyword)))) {
    const pos = r.position > 0 ? r.position : null;
    const prev = await prisma.rank_snapshots.findFirst({ where: { keyword: r.keyword, checked_on: { lt: today } }, orderBy: { checked_on: 'desc' } });
    await prisma.rank_snapshots.upsert({ where: { keyword_checked_on: { keyword: r.keyword, checked_on: today } }, create: { keyword: r.keyword, position: pos, checked_on: today }, update: { position: pos } });
    const before = prev?.position;
    const drop = before && (pos === null ? 101 - before : pos - before);
    if (before && drop >= 5) alerts.push(`${r.keyword}: ${before} to ${pos ?? 'not in top 100'} (down ${drop})`);
  }
  if (alerts.length) await notify(`Rank drop alert: ${alerts.length} priority keyword(s) fell 5+ positions`, alerts.join('\n'), { action: 'alert.rank_drop' });
  return { checked: priority.size, alerts };
}

// Weekly plan vs actual for the approved strategy.
export async function runWeekly(now = new Date()) {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return { skipped: 'No approved strategy' };
  const nowText = sqlNow(now);
  const blogs = await prisma.blog_schedule.findMany({ where: { strategy_id: s.id } });
  const due = blogs.filter((b) => b.publish_at <= nowText);
  const links = await prisma.backlink_tasks.findMany({ where: { strategy_id: s.id } });
  const today = now.toISOString().slice(0, 10);
  const result: any = {
    period: s.period,
    blogs: { plannedToDate: due.length, published: due.filter((b) => b.status === 'published').length, held: blogs.filter((b) => b.status === 'held').map((b) => b.title) },
    backlinks: { dueToDate: links.filter((l) => l.send_date <= today).length, done: links.filter((l) => l.status === 'done').length },
    autoApproved: blogs.filter((b) => b.approval_mode === 'auto').length,
    reviewed: blogs.filter((b) => b.approval_mode === 'reviewed').length,
  };
  // AI visibility vs the GEO and AEO targets (SE Ranking AI Search and AI Results Tracker).
  try {
    const ai = await gatherAiVisibility(SITE().replace(/^https?:\/\//, '').replace(/^www\./, ''));
    const plan = JSON.parse(s.plan_json);
    const target = (kpi) => plan.targets?.find((t) => t.kpi === kpi)?.target ?? null;
    result.ai = {
      chatMentions: { actual: ai.totals.chatMentions, target: target('AI chat mentions') },
      chatLinks: { actual: ai.totals.chatLinks.current, target: target('AI chat answers linking to us') },
      googleAiLinks: { actual: ai.totals.googleAiLinks.current, target: target('AI Overview citations') },
      errors: ai.errors,
    };
  } catch (e: any) {
    result.ai = { error: e.message };
  }
  await prisma.plan_checks.create({ data: { strategy_id: s.id, week_of: today, result: JSON.stringify(result) } });
  const behind = result.blogs.published < result.blogs.plannedToDate || result.backlinks.done < result.backlinks.dueToDate;
  await notify(
    `Weekly plan vs actual (${s.period})${behind ? ': behind plan' : ''}`,
    `Blogs: ${result.blogs.published} of ${result.blogs.plannedToDate} published. Held: ${result.blogs.held.join('; ') || 'none'}. Backlink tasks: ${result.backlinks.done} of ${result.backlinks.dueToDate} done.${result.ai?.chatLinks ? ` AI chat answers linking to us: ${result.ai.chatLinks.actual ?? 'DATA MISSING'} (target ${result.ai.chatLinks.target ?? 'not set'}). AI chat mentions: ${result.ai.chatMentions.actual ?? 'DATA MISSING'} (target ${result.ai.chatMentions.target ?? 'not set'}).` : ''}`,
    { action: 'check.plan_vs_actual' }
  );
  return result;
}

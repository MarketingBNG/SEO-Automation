// @ts-nocheck -- orchestration over untyped integration modules.
// Runs the approved month automatically: drafts blogs ahead of their slot, opens the 48-hour review
// window, auto-approves and publishes on schedule behind the automatic fact check and writing rules,
// does the after-publish steps, checks ranks daily and compares plan vs actual weekly.
import { createHash } from 'node:crypto';
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { researchAndWriteBlog, verifyAndCorrect } from '../anthropic';
import { CreditPausedError, isCreditError, assertCredits } from '../aiCredits';
import { aiMode, isAutomatic, TestingModeError } from '../aiQueue';
import { withReplay, clearReplay, markAiWait } from '../aiReplay';
import { claimPublish, publishingRows } from './publishLock';
import { connectorOn, authorSlug, siteOrigin } from '../siteConnector';
import { publishPost, updatePost, seoSlug, wpRequest, uploadMedia, freeSlug } from '../wordpress';
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
import { stopSupersededRows } from './replaced';
import { runSpeedFixes } from './speed';
import { authorNames, pickAuthor, wpAuthorId } from '../authors';
import { makeCover, coverAlt } from '../cover';
import { publishDraftImages } from '../inlineMedia';
import { saveFile } from '../storage';
import { callClaude } from '../anthropic';
import { scheduleAction, extractClaims, writingRuleIssues, faqSchema, faqAccordion, keywordKey, crawlIsFresh, needsExpertReview, reviewOverdue, REVIEW_HOURS, bestRankPerKeyword } from './core';
import { requireExpert } from '../reviewers';
import { submitToBing } from '../bing';
import { withByline, expertSchema } from '../byline';
import { startTimer, endTimer, timed, setStage } from '../jobTimer';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const HOST = () => SITE().replace(/^https?:\/\//, '').replace(/^www\./, '');
// Drafts are written 72 hours before the slot so the 48-hour review can start on time.
const DRAFT_LEAD_HOURS = 72;

const update = (id, data) => prisma.blog_schedule.update({ where: { id }, data: { ...data, updated_at: sqlNow() } });

// Paused AI credits, Anthropic's own out-of-credit answer and Testing mode are not failures: the
// work waits and continues by itself once AI work is possible again.
const waitsForAi = (e) => e instanceof CreditPausedError || isCreditError(e);

// Checked before a blog is started, so no keyword row and no paid research is spent on a run that
// cannot reach the AI (Testing mode for automatic work, or AI work paused for credits).
async function assertAiReady() {
  if (isAutomatic() && (await aiMode()) === 'testing') throw new TestingModeError();
  await assertCredits();
}

// Read again after a long write: a manager may have approved a newer version of the month meanwhile.
// A row whose strategy is no longer approved gets no paid fact check and no review notice; the next
// run stops it (lib/strategy/replaced.ts).
async function strategyStillApproved(strategyId) {
  const s = await prisma.seo_strategies.findUnique({ where: { id: strategyId }, select: { status: true } });
  return s?.status === 'approved';
}

// Writes the draft for one calendar row (the same pipeline as the Keywords tab). `busy` is the row's
// status while it is written ('revising' for a rewrite after a rejection).
// The finished AI steps are saved per calendar row (lib/aiReplay.ts): a run cut off by a credit
// pause, the Pause button or a restart reuses them when the row is written again.
async function writeDraft(row, extraNotes = '', write = researchAndWriteBlog, busy = 'drafting') {
  await assertAiReady();
  await update(row.id, { status: busy });
  // The partner the post goes out under is fixed when the draft is written, so the Word preview, the
  // cover and the live post all show the same name.
  const draftAuthor = row.author || (row.refresh_url ? null : pickAuthor(await authorNames()));
  const kw = await prisma.keywords.create({
    data: { batch_name: `Strategy #${row.strategy_id}`, keyword: row.main_keyword, notes: `Planned title: ${row.title}. Channels: ${JSON.parse(row.tags).join(', ')}.${row.refresh_url ? ` Refresh of ${row.refresh_url}.` : ''}${extraNotes ? `\n\n${extraNotes}` : ''}`, status: 'generating' },
  });
  const writer = progressWriter((stage, percent) => prisma.keywords.update({ where: { id: kw.id }, data: { progress_stage: stage, progress_percent: percent } }));
  // The step details reach the job timer too, so the header's time-left estimate is per step here
  // as well (the same wiring as lib/blogJob.ts for blogs started from the Keywords tab).
  const onProgress = (stage, percent, extra?: any) => {
    if (extra?.key) setStage(`blog-${kw.id}`, extra.key, { progress: extra.progress, round: extra.round, lastActivityAt: extra.lastActivityAt ?? null, label: stage });
    writer(stage, percent);
  };
  let result;
  const scope = `blog-sched-${row.id}`;
  startTimer(`blog-${kw.id}`, 'blog', `Blog: ${row.main_keyword}`);
  try {
    result = await withReplay(scope, () => write(row.main_keyword, kw.notes, { onProgress }));
    await endTimer(`blog-${kw.id}`, true);
  } catch (err: any) {
    await endTimer(`blog-${kw.id}`, false);
    // Never leave the keyword stuck as "generating"; the next scheduler run tries again.
    await prisma.keywords.update({ where: { id: kw.id }, data: { status: 'failed', error: String(err.message || err).slice(0, 1000), progress_stage: null, progress_percent: null } });
    await update(row.id, { status: 'planned' });
    // A run that only waits for AI keeps its saved steps for the restart. A real failure drops them
    // (as lib/blogJob.ts does), so Resume writes it again instead of replaying the same bad answers.
    if (!waitsForAi(err)) await clearReplay(scope).catch(() => {});
    else await markAiWait(scope);
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
      linkedin_post: result.linkedin || null,
      length_target: result.lengthTarget ? JSON.stringify(result.lengthTarget) : null,
      author: draftAuthor,
      status: 'pending_review',
      target_wp_post_id: null,
    },
  });
  // The photo cover (real photo for the topic, house design), made in the background.
  void import('../coverPhoto').then((m) => m.ensurePhotoCover(draft.id)).catch(() => {});
  // Plagiarism check in the background, so the result is ready for the review.
  void import('../originality').then((m) => m.checkDraftOriginality(draft.id)).catch(() => {});
  for (const f of result.facts) {
    await prisma.facts.create({ data: { draft_id: draft.id, fact_id: f.fact_id, claim: f.claim, source_name: f.source_name, source_url: f.source_url, jurisdiction: f.jurisdiction, effective_date: f.effective_date } });
  }
  await prisma.keywords.update({ where: { id: kw.id }, data: { status: 'drafted', progress_stage: null, progress_percent: null } });
  // A clean independent check by the writer pipeline counts as the first of the two clean checks the
  // review needs, so the review's own check (by the other model) is the only one still to run.
  const inlineClean = Boolean(
    result.factCheck && result.validation?.passed && result.factCheck.covered !== false && result.factCheck.checks.length > 0 && result.factCheck.checks.every((c) => c.verdict === 'correct')
  );
  await update(row.id, {
    keyword_id: kw.id,
    draft_id: draft.id,
    status: 'planned',
    // A new draft gets its own review: a review window opened for an earlier (rejected) version does
    // not count, so the new text never publishes without a person being able to see it.
    review_started: null,
    reminded_at: null,
    author: draftAuthor,
    cta: result.cta ? JSON.stringify(result.cta) : row.cta || null,
    fact_check: inlineClean ? JSON.stringify({ inlineStamp: draft.updated_at, inlineModel: result.factCheck.model, inlineClaims: result.factCheck.checks.length }) : null,
  });
  await clearReplay(scope);
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
  // No default domain here: a local or test server must not fetch the live site. A server that
  // publishes through the site connector checks the connector's site.
  const origin = siteOrigin();
  if (!origin) return 'neither WORDPRESS_SITE_URL nor the site connector is set, so the site cannot be checked';
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(15000) });
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

// After a blog goes live (calendar slot, or Publish in Drafts & Review): indexing, SE Ranking
// tracking and internal links. Each step is independent; the log of results goes on the calendar row.
export async function afterPublish(link: string, title: string, keyword: string | null | undefined) {
  const log: any = {};
  const step = async (name, fn) => {
    try {
      log[name] = { ok: true, result: await fn() };
    } catch (e: any) {
      log[name] = { ok: false, error: e.message };
    }
  };
  await step('indexNow', () => submitIndexNow([link]));
  await step('searchConsoleSitemap', () => resubmitSitemap());
  if (process.env.BING_WEBMASTER_API_KEY) await step('bingWebmaster', () => submitToBing([link]));
  if (keyword) {
    await step('seRankingTracking', () => addTrackedKeyword(keyword));
    await step('internalLinks', () => addInternalLinks(link, title, keyword));
  }
  return log;
}

// One line for the Activity Log: which steps after publishing failed, and which live posts got a link.
export function afterPublishSummary(log: any): string {
  if (!log) return 'the steps after publishing (indexing, tracking, internal links) could not run.';
  const failed = Object.entries(log).filter(([, v]: any) => !v?.ok).map(([k, v]: any) => `${k} failed (${String(v?.error || '').slice(0, 120)})`);
  const linked: string[] = Array.isArray(log.internalLinks?.result) ? log.internalLinks.result : [];
  return [
    failed.length ? failed.join('; ') : 'every step after publishing worked',
    linked.length ? `internal links added in ${linked.join(', ')}` : '',
  ].filter(Boolean).join('; ') + '.';
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
const textHash = (d: any) => createHash('sha256').update(`${d.title || ''}\n${d.meta_description || ''}\n${d.content_html || ''}`).digest('hex');

async function ensureFactChecked(row, draft, verify = verifyAndCorrect) {
  const prev = row.fact_check ? JSON.parse(row.fact_check) : null;
  if (prev && prev.stamp === draft.updated_at) return { ...prev, draft };
  // Only the words count: a new cover or alt text (which also moves updated_at) needs no new check.
  const words = textHash(draft);
  if (prev && prev.textHash === words) {
    const record = { ...prev, stamp: draft.updated_at };
    await update(row.id, { fact_check: JSON.stringify(record) });
    return { ...record, draft };
  }
  // Why it runs, shown on the progress bar.
  const why = !prev ? 'first check before publishing' : 'the text changed since the last check';
  const startClean = prev?.inlineStamp && prev.inlineStamp === draft.updated_at ? 1 : 0;
  const facts = await prisma.facts.findMany({ where: { draft_id: draft.id }, select: { fact_id: true, claim: true, source_url: true } });
  // Finished checks are saved per draft text, so a check cut off by a pause or restart is not paid twice.
  const scope = `factcheck-${draft.id}-${words}`;
  let result;
  try {
    result = await timed(`factcheck-${draft.id}`, 'fact-check', `Fact check before publishing (${why}): ${draft.title}`, () =>
      withReplay(scope, () =>
        verify(
          { title: draft.title, meta: draft.meta_description, content: draft.content_html || '', facts },
          { mustCheckOf: (html) => extractClaims(html).map((c) => c.sentence), startClean }
        )
      )
    );
  } catch (err) {
    // Same rule as writeDraft: only a run waiting for AI keeps its saved steps.
    if (!waitsForAi(err)) await clearReplay(scope).catch(() => {});
    else await markAiWait(scope);
    throw err;
  }
  let saved = draft;
  const changed = result.draft.content !== draft.content_html || result.draft.title !== draft.title || result.draft.meta !== draft.meta_description;
  if (changed) {
    saved = await prisma.drafts.update({
      where: { id: draft.id },
      data: { title: result.draft.title, meta_description: result.draft.meta, content_html: result.draft.content, word_count: String(result.draft.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, updated_at: sqlNow() },
    });
  }
  const record = { stamp: saved.updated_at, textHash: textHash(saved), ok: result.ok, rounds: result.rounds, corrected: changed, log: result.log, checkedAt: sqlNow(), inlineCounted: Boolean(startClean) };
  await update(row.id, { fact_check: JSON.stringify(record) });
  await clearReplay(scope);
  await activity.log('schedule.fact_checked', {
    entityType: 'draft',
    entityId: draft.id,
    details: `"${saved.title}": ${result.ok ? 'verified' : 'NOT verified'} after ${result.rounds} round(s)${changed ? ', corrections applied' : ''}`,
  });
  return { ...record, draft: saved };
}

// Rows being published right now in this server (scheduler, cron route, Publish now and Publish in
// Drafts & Review share it, lib/strategy/publishLock.ts), so two paths never publish the same blog at once.
const publishing = publishingRows;

// Returns 'published', 'held', or 'busy' when another path is publishing this row right now.
async function publishRow(row, now, verify = verifyAndCorrect) {
  const release = claimPublish(row.id, row.draft_id ?? null);
  if (!release) return 'busy';
  try {
    return await publishRowOnce(row, now, verify);
  } finally {
    release();
  }
}

async function publishRowOnce(row, now, verify) {
  const draft = row.draft_id ? await prisma.drafts.findUnique({ where: { id: row.draft_id } }) : null;
  if (!draft) {
    const why = JSON.stringify(['No draft was written in time.']);
    // Told once, not on every 15-minute run while it stays held.
    const first = row.status !== 'held' || row.hold_reasons !== why;
    await update(row.id, { status: 'held', hold_reasons: why });
    if (first) await notify(`Blog held: ${row.title}`, 'No draft was ready at the publish slot.');
    return 'held';
  }
  // K2: tax, legal and compliance blogs publish only after a named CA/CPA approves them.
  if (!row.reviewed_at && (await requireExpert()) && needsExpertReview(row.main_keyword, row.title)) {
    const why = 'Waiting for a CA/CPA reviewer to approve it in Monthly Strategy (tax, legal and compliance blogs never publish on their own).';
    if (row.status !== 'in_review' && row.hold_reasons !== JSON.stringify([why])) {
      await update(row.id, { status: 'held', hold_reasons: JSON.stringify([why]) });
      await notify(`Blog waiting for CA/CPA approval: ${row.title}`, why);
    }
    return 'held';
  }
  const reasons = [];
  const paused = await publishingPaused();
  if (paused) reasons.push(`Auto-publishing paused: ${paused}.`);
  if (draft.status === 'rejected') reasons.push('Reviewer rejected the draft.');
  // A blog a person reviewed or approved is not fact-checked again: the check at generation time
  // stands, and edits made in review are the reviewer's call. It publishes at its slot.
  const humanApproved = Boolean(row.reviewed_at) || draft.status === 'approved';
  // A blog already held because publishing is paused is not fact-checked now (each check is paid):
  // it is checked once the pause lifts.
  const fc = humanApproved || paused ? { ok: true, rounds: 0, draft } : await ensureFactChecked(row, draft, verify);
  const checked = fc.draft;
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(checked.content_html || '')) reasons.push('Draft still has a reviewer placeholder.');
  if (!fc.ok) reasons.push(`Fact check could not confirm every claim from a primary source after ${fc.rounds} rounds. Not published: correct the claims (the edited text is checked again) or approve the blog to publish it as it is.`);
  // A blog already held for another reason is not scored (each new Surfer Content Editor is paid).
  const score = reasons.length ? null : await surferScore(row.main_keyword, checked.content_html || '');
  for (const i of writingRuleIssues({ title: checked.title, meta: checked.meta_description, html: checked.content_html || '', surferScore: score, siteHost: HOST() })) reasons.push(i);
  // Never publish copied text: the blog is compared with the pages ranking for its keyword and
  // with our own posts (a check that cannot run does not block; its result shows on the draft).
  const { ensureOriginality, originalityReason } = await import('../originality');
  const orig = await ensureOriginality(checked.id).catch(() => null);
  if (orig && !orig.ok) reasons.push(originalityReason(orig));
  if (reasons.length) {
    const first = row.status !== 'held';
    await update(row.id, { status: 'held', hold_reasons: JSON.stringify(reasons) });
    if (first) await notify(`Blog held: ${row.title}`, reasons.join('\n'));
    return 'held';
  }

  // Reviewed = marked reviewed, approved in Drafts & Review, or edited by a person after review opened
  // (the fact checker's own corrections do not count as a review).
  const reviewed = Boolean(row.reviewed_at) || draft.status === 'approved' || Boolean(row.review_started && draft.updated_at > row.review_started && draft.updated_at !== (row.fact_check ? JSON.parse(row.fact_check).stamp : null));
  let post;
  let authorName = row.author || checked.author || null;
  let authorId: number | null = null;
  if (!row.refresh_url) authorName = authorName || pickAuthor(await authorNames());
  // Images a person placed in the article move to the WordPress Media Library first.
  const inline = await publishDraftImages(checked.id, checked.content_html || '');
  // The cover (uploaded, or the branded one made from the title and author) goes to the Media
  // Library with its alt text, so Google reads what the picture shows; its address also goes into
  // the article schema.
  let cover: { id: number; url: string } | null = null;
  if (!row.refresh_url) {
    authorId = await wpAuthorId(authorName).catch(() => null);
    let imageKey = checked.featured_image_path || (await import('../coverPhoto').then((m) => m.ensurePhotoCover(checked.id)).catch(() => null));
    if (!imageKey) {
      imageKey = await saveFile(`covers/${Date.now()}-${seoSlug(row.main_keyword)}.png`, await makeCover(checked.title, authorName), 'image/png').catch(() => null);
      if (imageKey) await prisma.drafts.update({ where: { id: checked.id }, data: { featured_image_path: imageKey } });
    }
    cover = imageKey ? await uploadMedia(imageKey, { altText: coverAlt(checked), title: checked.title }).catch(() => null) : null;
  }
  // Published meanwhile by another path (Publish in Drafts & Review): not sent a second time.
  const latest = await prisma.drafts.findUnique({ where: { id: checked.id }, select: { status: true, wp_post_id: true, wp_post_url: true } });
  if (latest?.status === 'published' && latest.wp_post_url) {
    await update(row.id, { status: 'published', wp_post_url: latest.wp_post_url, hold_reasons: null });
    return 'published';
  }
  if (latest?.wp_post_id) checked.wp_post_id = latest.wp_post_id;
  const html = `${withByline(faqAccordion(inline.html), authorName, row.expert_reviewer)}\n${faqSchema(checked.content_html) || ''}\n${expertSchema({ title: checked.title, author: authorName, reviewer: row.expert_reviewer, image: cover?.url || null }) || ''}`;
  if (row.refresh_url) {
    const { json: found } = await wpRequest('GET', '/wp/v2/posts', { query: { slug: new URL(row.refresh_url).pathname.split('/').filter(Boolean).pop(), _fields: 'id,link' } });
    if (!found?.[0]) throw new Error(`Refresh target not found: ${row.refresh_url}`);
    post = await updatePost(found[0].id, { title: checked.title, contentHtml: html, excerpt: checked.meta_description, metaDescription: checked.meta_description, focusKeyphrase: row.main_keyword, status: 'publish' });
  } else {
    const fields = { title: checked.title, contentHtml: html, excerpt: checked.meta_description, featuredMediaId: cover?.id, status: 'publish', slug: seoSlug(row.main_keyword), metaDescription: checked.meta_description, focusKeyphrase: row.main_keyword, author: authorId || undefined, authorName };
    // The planned address must be free: a copy that was never live is moved to the trash.
    const freed = await freeSlug(fields.slug, checked.wp_post_id).catch(() => null);
    if (freed?.trashed.length) await activity.log('wordpress.duplicate_trashed', { entityType: 'draft', entityId: checked.id, details: `"${checked.title}": moved WordPress post(s) ${freed.trashed.map((x) => `#${x}`).join(', ')} (never live) to the trash to free /${fields.slug}/` });
    // Sent to WordPress earlier as a draft (from Drafts & Review): publish that post, not a second copy.
    const existing = checked.wp_post_id ? await wpRequest('GET', `/wp/v2/posts/${checked.wp_post_id}`, { query: { context: 'edit', _fields: 'status' } }).then((r: any) => r.json?.status).catch(() => null) : null;
    post = existing && existing !== 'trash' ? await updatePost(checked.wp_post_id, fields) : await publishPost(fields);
  }
  await prisma.drafts.update({
    where: { id: checked.id },
    data: { status: 'published', wp_post_id: post.id, wp_post_url: post.link, linkedin_post: checked.linkedin_post ? checked.linkedin_post.replace(/LINK HERE/g, post.link) : null, updated_at: sqlNow() },
  });

  // After publish: each step is independent and its result is logged.
  const log: any = await afterPublish(post.link, checked.title, row.main_keyword);

  if (inline.uploaded.length) log.inlineImages = { ok: true, result: `${inline.uploaded.length} image(s) in the Media Library${inline.uploaded.some((u) => u.reused) ? ' (some reused from an earlier attempt)' : ''}` };
  if (!row.refresh_url) log.cover = cover ? { ok: true, result: `Cover in the Media Library with alt text "${coverAlt(checked)}"` } : { ok: false, result: 'The cover could not be uploaded, so the post has no featured image. Upload one in Drafts & Review and republish, or set it in WordPress.' };
  log.author = !authorName
    ? undefined
    : connectorOn()
      ? { ok: Boolean(authorSlug(authorName)), result: authorSlug(authorName) ? `${authorName} (website author ${authorSlug(authorName)})` : `${authorName} is not an author on the website yet, so the website's default author was used` }
      : { ok: Boolean(authorId), result: authorId ? `${authorName} (WordPress user ${authorId})` : `${authorName} is not a WordPress user yet, so the default author was used` };
  await update(row.id, { status: 'published', approval_mode: reviewed ? 'reviewed' : 'auto', wp_post_url: post.link, post_publish_log: JSON.stringify(log), hold_reasons: null, author: authorName });
  await activity.log('schedule.published', { entityType: 'draft', entityId: checked.id, details: `"${checked.title}" ${reviewed ? `approved by a reviewer${row.expert_reviewer ? ` (${row.expert_reviewer})` : ''}` : 'auto-approved after 48 hours with no rejection'}, by ${authorName || 'the default author'}: ${post.link}` });
  return 'published';
}

// A rejected blog is rewritten with the reviewer's feedback, fact-checked again, and returned to
// review with a short "you asked, we changed" note and a new 48-hour window.
async function reviseRow(row, verify = verifyAndCorrect, write = researchAndWriteBlog) {
  const old = row.draft_id ? await prisma.drafts.findUnique({ where: { id: row.draft_id } }) : null;
  await update(row.id, { status: 'revising' });
  const plainOld = String(old?.content_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
  const feedback = String(row.reject_feedback || '').trim();
  let draft;
  try {
    draft = await writeDraft(
      row,
      `A reviewer REJECTED the previous version. Apply ALL of this feedback exactly:\n${feedback}\n\nPrevious version (keep what was good, fix what the feedback asks):\n${plainOld}`,
      write,
      'revising'
    );
  } catch (e) {
    await update(row.id, { status: 'rejected' });
    throw e;
  }
  // Its strategy was replaced during the rewrite: no summary call, fact check or review notice.
  if (!(await strategyStillApproved(row.strategy_id))) return draft;
  let note = [];
  try {
    const { text } = await callClaude(
      'Compare the reviewer feedback with the new blog. For each point the reviewer raised, say in one short plain-English sentence what was changed. No em dashes. Return ONLY ===JSON===[{"asked":"","changed":""}]===END===',
      [{ role: 'user', content: `Reviewer feedback:\n${feedback}\n\nNew blog:\n${String(draft.content_html || '').replace(/<[^>]+>/g, ' ').slice(0, 15000)}` }],
      undefined,
      { maxUses: 1, effort: 'low', feature: 'blog' }
    );
    const m = text.match(/===JSON===([\s\S]*?)===END===/);
    note = m ? JSON.parse(m[1]) : [];
  } catch {
    note = [{ asked: feedback, changed: 'The blog was rewritten with this feedback.' }];
  }
  const fresh = await prisma.blog_schedule.findUnique({ where: { id: row.id } });
  await ensureFactChecked(fresh, draft, verify);
  await update(row.id, { status: 'in_review', review_started: sqlNow(), reviewed_at: null, reviewed_by: null, revision_note: JSON.stringify(note), revisions: (row.revisions || 0) + 1 });
  await notify(`Rewritten blog ready for review: ${draft.title}`, `It was rewritten with the feedback from ${row.rejected_by || 'the reviewer'}. Approve or reject it in Monthly Strategy within 48 hours.`);
  await activity.log('schedule.revised', { entityType: 'draft', entityId: draft.id, details: `"${draft.title}" rewritten after rejection (${note.length} point(s) addressed); new 48-hour review` });
  return draft;
}

// One server process runs the jobs, so an in-memory flag stops a scheduled call from overlapping a
// run that is still writing a long maximum-effort draft. It is kept on globalThis: the built-in
// scheduler and the cron route each load their own copy of this module.
const gr = globalThis as unknown as { __autopilotRunning?: boolean };

// A failed blog is stopped, not retried every 15 minutes (each retry can spend credits and repeats
// the same error): logged, paused with the reason, and one notice sent.
async function stopAfterFailure(row, e, from = row.status) {
  await activity.log('schedule.failed', { entityType: 'blog_schedule', entityId: row.id, details: `${row.title}: ${e.message}` });
  const reason = `Stopped after a failure, so it is not tried again on its own: ${String(e.message || e).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}. Fix the cause, then press Resume or Publish now. If it is already done, press Already done.`;
  await update(row.id, { status: 'paused', paused_from: from, paused_by: 'Automatic (stopped after a failure)', hold_reasons: JSON.stringify([reason]) }).catch(() => {});
  await notify(`Blog stopped after a failure: ${row.title}`, reason).catch(() => {});
}

// The scheduler job. Meant to run every 15 minutes; every step is idempotent.
// "Publish now" from the calendar: a reviewed or approved blog goes to the website at once instead
// of waiting for its slot (a paused one is resumed). The usual publish checks still apply; when one
// fails, the blog is held with the reason. Returns 'published' or 'held'.
export async function publishScheduleNow(id: number, actor = 'system') {
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  if (row.status === 'published') throw Object.assign(new Error('Already published'), { status: 409 });
  if (['drafting', 'revising'].includes(row.status)) throw Object.assign(new Error('It is being written right now. Try again in a few minutes.'), { status: 409 });
  if (publishing.has(id)) throw Object.assign(new Error('It is being published right now. Try again in a few minutes.'), { status: 409 });
  const draft = row.draft_id ? await prisma.drafts.findUnique({ where: { id: row.draft_id } }) : null;
  if (!draft) throw Object.assign(new Error('This blog has no draft yet.'), { status: 409 });
  if (!row.reviewed_at && draft.status !== 'approved') throw Object.assign(new Error('Approve it first (Approve here or in Drafts & Review), then publish.'), { status: 409 });
  const now = new Date();
  const back = row.status === 'paused' ? row.paused_from || 'in_review' : row.status;
  const ready = await prisma.blog_schedule.update({ where: { id }, data: { status: back, paused_from: null, paused_by: null, publish_at: sqlNow(now), updated_at: sqlNow() } });
  await activity.log('schedule.publish_now', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}": Publish now pressed (slot was ${row.publish_at} UTC)`, actor });
  const result = await publishRow(ready, now);
  if (result === 'busy') throw Object.assign(new Error('It is being published right now. Try again in a few minutes.'), { status: 409 });
  const after = await prisma.blog_schedule.findUnique({ where: { id } });
  return { result, wp_post_url: after?.wp_post_url || null, hold_reasons: JSON.parse(after?.hold_reasons || '[]') };
}

export async function runDaily(now = new Date(), opts: { maxDrafts?: number; verify?: any; write?: any } = {}) {
  if (gr.__autopilotRunning) return { skipped: 'A previous run is still in progress.' };
  gr.__autopilotRunning = true;
  try {
    return await runDailyOnce(now, opts);
  } finally {
    gr.__autopilotRunning = false;
  }
}

async function runDailyOnce(now: Date, { maxDrafts = 1, verify = verifyAndCorrect, write = researchAndWriteBlog }: { maxDrafts?: number; verify?: any; write?: any }) {
  const summary: any = { opened: 0, published: 0, held: 0, drafted: 0, errors: [] };
  // Only the calendars of approved strategies run (a replaced strategy's blogs do not).
  const approvedIds = (await prisma.seo_strategies.findMany({ where: { status: 'approved' }, select: { id: true } })).map((s) => s.id);
  // No run is in progress (the flag above), so a row still 'revising' was cut off by a restart: it
  // is rewritten again, reusing the finished AI steps.
  await prisma.blog_schedule.updateMany({ where: { status: 'revising' }, data: { status: 'rejected', updated_at: sqlNow() } });
  // Blogs of a replaced strategy stop visibly (paused with the reason, or removed when not written),
  // also for a strategy replaced before this rule existed and for a draft that was still being
  // written when its strategy was replaced.
  try {
    const stopped = await stopSupersededRows(sqlNow());
    for (const r of stopped.paused) await activity.log('schedule.paused', { entityType: 'blog_schedule', entityId: r.id, details: `"${r.title}" paused: its strategy was replaced by a newer approved version` });
    if (stopped.removed.length) await activity.log('schedule.removed', { entityType: 'blog_schedule', details: `${stopped.removed.length} unwritten blog(s) of a replaced strategy removed and their keywords freed` });
  } catch (e: any) {
    summary.errors.push(`Replaced strategy clean-up failed: ${e.message}`);
  }
  const rows = await prisma.blog_schedule.findMany({ where: { status: { in: ['planned', 'drafting', 'in_review', 'held'] }, strategy_id: { in: approvedIds } }, orderBy: { publish_at: 'asc' } });

  // Rejected blogs are rewritten first (one per run; a full rewrite takes a while).
  const rejected = await prisma.blog_schedule.findFirst({ where: { status: 'rejected', strategy_id: { in: approvedIds } }, orderBy: { updated_at: 'asc' } });
  if (rejected && summary.drafted < maxDrafts) {
    try {
      await reviseRow(rejected, verify, write);
      summary.drafted++;
    } catch (e: any) {
      summary.errors.push(`${rejected.title}: rewrite failed: ${e.message}`);
      if (!waitsForAi(e)) {
        // When the new draft was already saved (the row is 'planned' again) and a later step failed,
        // Resume continues from that draft (its review opens) instead of paying for a new rewrite.
        const cur = await prisma.blog_schedule.findUnique({ where: { id: rejected.id }, select: { status: true } }).catch(() => null);
        await stopAfterFailure(rejected, { message: `rewrite failed: ${e.message}` }, cur?.status === 'planned' ? 'planned' : 'rejected');
      }
    }
  }

  const expertOn = await requireExpert();
  for (const row of rows) {
    const action = scheduleAction(row, now, 0, { requireExpert: expertOn });
    try {
      if (action === 'open_review') {
        if (!row.draft_id && summary.drafted < maxDrafts) {
          await writeDraft(row, '', write);
          summary.drafted++;
        }
        const fresh = await prisma.blog_schedule.findUnique({ where: { id: row.id } });
        if (fresh.draft_id && (await strategyStillApproved(fresh.strategy_id))) {
          // Fact-check before reviewers see it, so they review the corrected version.
          const d = await prisma.drafts.findUnique({ where: { id: fresh.draft_id } });
          if (d) await ensureFactChecked(fresh, d, verify);
          await update(row.id, { status: 'in_review', review_started: sqlNow(now) });
          await notify(`Blog ready for review: ${row.title}`, `Approve or reject it in Monthly Strategy within 48 hours. If nobody rejects it, it is approved and published automatically.`);
          summary.opened++;
        }
      } else if (action === 'publish' && !row.draft_id && ['planned', 'drafting', 'held'].includes(row.status)) {
        // Its slot passed with no draft (AI was unavailable, or a person deleted the draft to get a
        // fresh one): it is written now and then gets its review, instead of being held for good.
        // Also a row left 'drafting' by a restart mid-write (no run is in progress here, the flag in
        // runDaily) and a row already held for 'No draft was written in time'.
        if (summary.drafted < maxDrafts) {
          // The hold reason is cleared only once AI work is possible, so a row waiting for AI keeps it.
          await assertAiReady();
          if (row.hold_reasons) await update(row.id, { hold_reasons: null });
          try {
            await writeDraft(row, '', write);
          } catch (err) {
            // Anthropic's out-of-credit answer (or a pause) in the middle of the write: the row waits
            // for AI again, so its hold and reason come back and the calendar still says why.
            if (waitsForAi(err) && row.hold_reasons) await update(row.id, { hold_reasons: row.hold_reasons, ...(row.status === 'held' ? { status: 'held' } : {}) }).catch(() => {});
            throw err;
          }
          summary.drafted++;
        }
      } else if (action === 'publish') {
        const r = await publishRow(row, now, verify);
        if (r !== 'busy') summary[r]++;
      } else if (!row.draft_id && row.status === 'planned' && Date.parse(row.publish_at.replace(' ', 'T') + 'Z') - now.getTime() <= DRAFT_LEAD_HOURS * 3600000 && summary.drafted < maxDrafts) {
        await writeDraft(row, '', write);
        summary.drafted++;
      }
    } catch (e: any) {
      summary.errors.push(`${row.title}: ${e.message}`);
      // Paused AI credits (also Anthropic's out-of-credit answer) or Testing mode are not a failure:
      // that work continues by itself once AI work is possible again, so nothing is logged as failed.
      if (!waitsForAi(e)) await stopAfterFailure(row, e);
    }
  }

  // K9: a review that ran past 48 hours gets a reminder, then one every 12 hours until decided.
  summary.reminders = 0;
  // Read again: a blog published or held above is no longer waiting for a review.
  const open = await prisma.blog_schedule.findMany({ where: { status: 'in_review', strategy_id: { in: approvedIds } }, orderBy: { publish_at: 'asc' } });
  for (const row of open.filter((r) => reviewOverdue(r, now))) {
    const last = row.reminded_at ? Date.parse(row.reminded_at.replace(' ', 'T') + 'Z') : 0;
    if (now.getTime() - last < 12 * 3600000) continue;
    const hours = Math.round((now.getTime() - Date.parse(row.review_started.replace(' ', 'T') + 'Z')) / 3600000);
    const expert = expertOn && needsExpertReview(row.main_keyword, row.title);
    await notify(
      `Overdue review (${hours} hours): ${row.title}`,
      `This blog has waited ${hours} hours, past the ${REVIEW_HOURS}-hour review time. ${expert ? 'It is a tax, legal or compliance blog, so it will not publish until a CA/CPA approves it.' : 'It publishes on its own if nobody rejects it.'} Approve or reject it in Monthly Strategy.`,
      { action: 'alert.review_overdue' }
    );
    await update(row.id, { reminded_at: sqlNow(now) });
    summary.reminders++;
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
    // The SE Ranking link check runs once a day even while the pass repeats waiting for AI.
    const checkLinks = (await settings.get('last_outreach_link_check')) !== today;
    // Leads whose opening line is already saved are pushed on the first pass of the day only, so a
    // repeat pass does not try (and give up on) a lead Smartlead refused 15 minutes earlier.
    const push = (await settings.get('last_outreach_push')) !== today;
    summary.outreach = await runOutreach(now, { checkLinks, push }).catch((e) => ({ error: e.message }));
    if (!summary.outreach?.error && checkLinks) await settings.set('last_outreach_link_check', today);
    if (!summary.outreach?.error && push) await settings.set('last_outreach_push', today);
    // Tasks that need Claude while AI work is not possible keep the day open (the rest was done).
    if (!summary.outreach?.error && !summary.outreach?.waitingForAi) await settings.set('last_outreach_run', today);
  }
  // Speed: page cache plugin and WebP images, once per day (only while a strategy is approved).
  if ((await settings.get('last_speed_run')) !== today && (await prisma.seo_strategies.count({ where: { status: 'approved' } }))) {
    summary.speed = await runSpeedFixes().catch((e) => ({ error: e.message }));
    if (!summary.speed?.error) await settings.set('last_speed_run', today);
  }
  // Live website checks (AI text on posts, sitemap in robots.txt, attachment pages), once per day.
  if ((await settings.get('last_site_check')) !== today) {
    const { runSiteChecks } = await import('../siteChecks');
    summary.siteChecks = await runSiteChecks().catch((e) => ({ error: e.message }));
    if (!summary.siteChecks?.error) await settings.set('last_site_check', today);
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
  // One row per keyword: a project tracking several engines lists each keyword once per engine, and
  // only the best position is stored and compared (rank_snapshots has one value per keyword and day).
  const rows = bestRankPerKeyword(await getSiteRankings(sites[0].id));
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

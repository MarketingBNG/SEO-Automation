import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { searchPosts, livePosts, getPost, findPostByUrl } from '@/lib/site';
import { querySearchAnalytics, comparisonRanges } from '@/lib/searchConsole';
import { getSummary, getTopLandingPages } from '@/lib/ga4';
import { listSites, getSiteRankings, researchKeywords } from '@/lib/seranking';
import { liveSearch } from '@/lib/serphouse';
import { peopleAlsoAsk, aiOverviewSummary } from '@/lib/researchBrief';
import { getInsights } from '@/lib/clarity';
import { runPageSpeedCheck } from '@/lib/pagespeed';
import { getLeadSourceBreakdown } from '@/lib/zoho';
import { recordQuestions, summary as questionBankSummary } from '@/lib/questionBank';
import { createAudit } from '@/lib/audits';
import { sqlNow } from '@/lib/time';
import type { Action } from '@/lib/permissions';
import { TAB_TOOLS } from './tabTools';

// Every tool is either 'read' (runs immediately) or 'write' (only runs after the human approves
// it in the dashboard). A write tool's run() returns { result, change } where change describes how
// to reverse it; the engine records that in site_changes so the dashboard can offer Undo.

const MAX_RESULT_CHARS = 40000;

function hash(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

function plainText(str) {
  return String(str || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(str, max = 160) {
  const s = plainText(str);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function contextAround(content, idx, radius = 120) {
  return {
    before: content.slice(Math.max(0, idx - radius), idx),
    after: content.slice(idx, idx + radius),
  };
}

function decode(str) {
  return String(str || '')
    .replace(/&#8212;/g, '-')
    .replace(/&#8211;/g, '-')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"');
}

const TOOLS: any[] = [];

function defineTool(tool: any) {
  TOOLS.push({ risk: 'low', ...tool });
}

// ---------------------------------------------------------------------------------------------
// Dashboard data (read)
// ---------------------------------------------------------------------------------------------

defineTool({
  name: 'dashboard_overview',
  kind: 'read',
  description:
    'Snapshot of the dashboard: keyword pipeline counts by status, drafts by status, number of blog audits, Fireflies meeting insights waiting for review, the latest SEO strategy, the active content-writing skill, and the 10 most recent activity-log entries.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read dashboard overview',
  // PORT NOTE: SELECT status, COUNT(*) ... GROUP BY status -> groupBy ordered by status (SQLite's GROUP BY order).
  run: async (_input, ctx) => ({
    keywords: (await (prisma.keywords as any).groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } })).map((r: any) => ({ status: r.status, count: r._count._all })),
    drafts: (await (prisma.drafts as any).groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } })).map((r: any) => ({ status: r.status, count: r._count._all })),
    audits: await prisma.blog_audits.count(),
    meetingInsightsPendingReview: await prisma.client_insights.count({ where: { status: 'pending_review' } }),
    latestStrategy: (await prisma.seo_strategies.findFirst({ select: { id: true, period: true, status: true, created_at: true }, orderBy: { id: 'desc' } })) || null,
    activeWritingSkill: (await prisma.writing_skills.findFirst({ where: { status: 'active' }, select: { id: true, created_at: true }, orderBy: { id: 'desc' } })) || null,
    recentActivity: await prisma.activity_log.findMany({ where: activityWhere(ctx?.me), select: { action: true, details: true, actor: true, created_at: true }, orderBy: { id: 'desc' }, take: 10 }),
  }),
});

defineTool({
  name: 'list_keywords',
  kind: 'read',
  description: 'List keywords in the blog pipeline, optionally filtered by status (pending, generating, drafted, failed).',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'generating', 'drafted', 'failed'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `List keywords${i.status ? ` (${i.status})` : ''}`,
  run: async ({ status, limit = 50 }) =>
    prisma.keywords.findMany({
      where: status ? { status } : {},
      select: { id: true, keyword: true, batch_name: true, status: true, error: true, created_at: true },
      orderBy: { id: 'desc' },
      take: limit,
    }),
});

defineTool({
  name: 'list_drafts',
  kind: 'read',
  description: 'List AI-written blog drafts with their review status (pending_review, approved, rejected, published) and quality state. "search" finds drafts whose title or keyword contains the words.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['in_progress', 'pending_review', 'approved', 'rejected', 'published'] },
      search: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `List drafts${i.status ? ` (${i.status})` : ''}${i.search ? ` matching "${i.search}"` : ''}`,
  run: async ({ status, search, limit = 20 }) => {
    const cols = { id: true, title: true, status: true, production_state: true, word_count: true, wp_post_url: true, created_at: true, updated_at: true, keyword: { select: { keyword: true } } };
    const q = String(search || '').trim();
    const where: any = { ...(status ? { status } : {}), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { keyword: { keyword: { contains: q, mode: 'insensitive' } } }] } : {}) };
    const rows = await prisma.drafts.findMany({ where, select: cols, orderBy: { id: 'desc' }, take: limit });
    const sched = await prisma.blog_schedule.findMany({ where: { draft_id: { in: rows.map((r) => r.id) } }, select: { draft_id: true, status: true, publish_at: true } });
    const cal = new Map(sched.map((x) => [x.draft_id, x]));
    return rows.map(({ keyword, ...r }: any) => ({ ...r, keyword: keyword?.keyword ?? null, calendar: cal.get(r.id) ? { status: cal.get(r.id)!.status, publish_at: cal.get(r.id)!.publish_at } : null }));
  },
});

defineTool({
  name: 'get_draft',
  kind: 'read',
  description: 'Full details of one blog draft: title, meta description, HTML content, validation issues, and its Facts Register (every claim with source and verification status).',
  input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false },
  summarize: (i) => `Read draft #${i.id}`,
  run: async ({ id }) => {
    const draft = await prisma.drafts.findUnique({ where: { id } });
    if (!draft) throw new Error(`Draft ${id} not found`);
    const facts = await prisma.facts.findMany({
      where: { draft_id: id },
      select: { fact_id: true, claim: true, source_name: true, source_url: true, status: true },
      orderBy: { id: 'asc' },
    });
    return {
      id: draft.id,
      title: draft.title,
      meta_description: draft.meta_description,
      status: draft.status,
      production_state: draft.production_state,
      validation_issues: JSON.parse(draft.validation_issues || '[]'),
      word_count: draft.word_count,
      wp_post_url: draft.wp_post_url,
      content_html: draft.content_html,
      facts,
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Blog drafts in the dashboard (Drafts & Review), whatever their status: in review, rejected,
// approved, or paused / rescheduled on the monthly calendar. These change only the dashboard copy;
// a blog already on the website is updated by publishing it again from Drafts & Review.
// ---------------------------------------------------------------------------------------------

const DRAFT_FIELDS = ['title', 'meta_description', 'content_html'] as const;

async function loadDraft(id) {
  const draft: any = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) throw new Error(`Draft ${id} not found. Find it with list_drafts.`);
  return draft;
}

const draftHash = (fields) => hash(JSON.stringify(fields));
// Visible words of an HTML snippet, keeping [VISUAL SUGGESTION: ...] style notes (plainText drops them).
const textOf = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
const wordsIn = (html) => plainText(html).split(' ').filter(Boolean).length;

function draftNote(draft) {
  return draft.wp_post_url
    ? `This blog is already on the website (${draft.wp_post_url}). This changes only the dashboard copy; to update the live post, publish the draft again from Drafts & Review ("Update the live post").`
    : null;
}

// Applies the edits in order. Every "find" must match exactly once (or replace_all), or nothing is applied.
function applyDraftEdits(html, edits) {
  let out = String(html || '');
  const problems: string[] = [];
  const done: any[] = [];
  edits.forEach((e, k) => {
    if (!e.find) {
      problems.push(`Change ${k + 1}: "find" is empty.`);
      return;
    }
    const n = countOccurrences(out, e.find);
    if (n === 0) problems.push(`Change ${k + 1}: the text was not found. Copy "find" exactly from content_html (get_draft), tags included: "${snippet(e.find, 80)}"`);
    else if (n > 1 && !e.replace_all) problems.push(`Change ${k + 1}: the text appears ${n} times; use a longer unique snippet or set replace_all: "${snippet(e.find, 80)}"`);
    else {
      const idx = out.indexOf(e.find);
      const around = contextAround(out, idx, 60);
      done.push({ field: `Change ${k + 1}${e.replace_all && n > 1 ? ` (${n} places)` : ''}`, before: `…${textOf(around.before).slice(-60)} [${textOf(e.find) || e.find.slice(0, 160)}]`, after: textOf(e.replace) || (e.replace ? e.replace.slice(0, 160) : '(removed)') });
      out = e.replace_all ? out.split(e.find).join(e.replace) : out.replace(e.find, () => e.replace);
    }
  });
  return { html: out, problems, done };
}

async function saveDraftFields(draft, fields, summary) {
  const before = Object.fromEntries(Object.keys(fields).map((k) => [k, draft[k] ?? null]));
  const counted = fields.content_html != null ? { word_count: String(fields.content_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length } : {};
  await prisma.drafts.update({ where: { id: draft.id }, data: { ...fields, ...counted, updated_at: sqlNow() } });
  await (await import('../factCheckMark')).markEditedAsChecked(draft.id, 'the Assistant', { byPerson: false }).catch(() => {});
  return {
    summary,
    targetType: 'draft',
    targetId: String(draft.id),
    undo: { kind: 'restore_draft', id: draft.id, fields: before, expectHash: draftHash(fields) },
  };
}

defineTool({
  name: 'draft_edit_text',
  kind: 'write',
  risk: 'low',
  description:
    'Change wording inside a dashboard blog draft (Drafts & Review): replace a sentence or paragraph, fix a figure, change a link, add a paragraph after another one, delete text. Works for drafts in any status. Give every change the user asked for in one call (up to 50, applied in order). Each "find" is copied exactly from content_html returned by get_draft (HTML tags included) and must match exactly once unless replace_all is true. To add text, find the end of the element it goes after (e.g. "...last words.</p>") and replace it with that same text plus the new element. To delete, replace with "". If any change does not match, nothing is applied.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      edits: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          properties: { find: { type: 'string' }, replace: { type: 'string' }, replace_all: { type: 'boolean' } },
          required: ['find', 'replace'],
          additionalProperties: false,
        },
      },
    },
    required: ['id', 'edits'],
    additionalProperties: false,
  },
  summarize: (i) => `Edit blog draft #${i.id}: ${i.edits.length} change${i.edits.length > 1 ? 's' : ''}${i.edits.length === 1 ? ` ("${snippet(i.edits[0].find, 50)}" → "${snippet(i.edits[0].replace, 50)}")` : ''}`,
  preview: async (i) => {
    const draft = await loadDraft(i.id);
    const { html, problems, done } = applyDraftEdits(draft.content_html, i.edits);
    return {
      target: `Draft #${draft.id}: ${draft.title || '(untitled)'} (${draft.status})`,
      changes: done,
      words: `${wordsIn(draft.content_html)} → ${wordsIn(html)}`,
      problem: problems.length ? `${problems.join(' ')} Nothing would be changed.` : null,
      warning: draftNote(draft),
    };
  },
  run: async (i) => {
    const draft = await loadDraft(i.id);
    const { html, problems } = applyDraftEdits(draft.content_html, i.edits);
    if (problems.length) throw new Error(`${problems.join(' ')} Nothing was changed (the draft may have been edited since; read it again with get_draft).`);
    const change = await saveDraftFields(draft, { content_html: html }, `Edited blog draft "${draft.title || draft.id}" (${i.edits.length} change${i.edits.length > 1 ? 's' : ''})`);
    return { result: { id: draft.id, changes: i.edits.length, words: wordsIn(html), note: draftNote(draft) || 'Saved. The user sees it when they open the draft in Drafts & Review.' }, change };
  },
});

defineTool({
  name: 'draft_update_fields',
  kind: 'write',
  riskFor: (i) => (i.content_html !== undefined ? 'medium' : 'low'),
  description:
    'Set the title, meta description and/or the whole article (content_html) of a dashboard blog draft (Drafts & Review), in any status. Use content_html only when the user wants the whole article replaced (e.g. by a rewritten version from a file they attached); for changes to parts of the article use draft_edit_text. content_html is clean HTML starting at <h2> (no <h1>, no byline), and keeps the existing images (<img src="/api/uploads/...">) and [VISUAL SUGGESTION: ...] notes unless the user says otherwise.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      title: { type: 'string' },
      meta_description: { type: 'string' },
      content_html: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  summarize: (i) => `Update blog draft #${i.id}: ${DRAFT_FIELDS.filter((f) => i[f] !== undefined).map((f) => (f === 'content_html' ? 'whole article' : f.replace('_', ' '))).join(', ') || 'nothing'}`,
  preview: async (i) => {
    const draft = await loadDraft(i.id);
    const fields = DRAFT_FIELDS.filter((f) => i[f] !== undefined);
    const lostImages = i.content_html !== undefined ? (String(draft.content_html || '').match(/\/api\/uploads\/[^"]+/g) || []).filter((src) => !i.content_html.includes(src)).length : 0;
    return {
      target: `Draft #${draft.id}: ${draft.title || '(untitled)'} (${draft.status})`,
      changes: fields.map((f) =>
        f === 'content_html'
          ? { field: 'article', before: `${wordsIn(draft.content_html)} words`, after: `${wordsIn(i.content_html)} words` }
          : { field: f.replace('_', ' '), before: draft[f] || '', after: i[f] }
      ),
      problem: fields.length ? null : 'Nothing to change.',
      warnings: [lostImages ? `${lostImages} image(s) in the current article are not in the new one and would be removed.` : '', /<h1\b/i.test(i.content_html || '') ? 'The new article has an <h1>; the website prints the title as the H1, so start at <h2>.' : '', draftNote(draft) || ''].filter(Boolean),
    };
  },
  run: async (i) => {
    const draft = await loadDraft(i.id);
    const fields = Object.fromEntries(DRAFT_FIELDS.filter((f) => i[f] !== undefined).map((f) => [f, String(i[f])]));
    if (!Object.keys(fields).length) throw new Error('Give at least one of title, meta_description or content_html.');
    if (fields.content_html !== undefined && wordsIn(fields.content_html) < 100) throw new Error('The new article has under 100 words, so it was not saved. Send the whole article, or use draft_edit_text for a partial change.');
    const what = Object.keys(fields).map((f) => (f === 'content_html' ? 'article' : f.replace('_', ' '))).join(', ');
    const change = await saveDraftFields(draft, fields, `Updated blog draft "${draft.title || draft.id}": ${what}`);
    return { result: { id: draft.id, updated: Object.keys(fields), note: draftNote(draft) || 'Saved. The user sees it when they open the draft in Drafts & Review.' }, change };
  },
});

defineTool({
  name: 'post_my_blog',
  kind: 'write',
  riskFor: (i) => (i.mode === 'post' ? 'high' : 'low'),
  description:
    'Post the user\'s OWN blog (pasted text or HTML, or an attached Word file\'s text) as it is: it is saved to Drafts & Review and, with mode "post", put live on the website straight away through the same publish step as Drafts & Review. Use when the user says to post or publish their blog as it is ("bas post kar do", "without fact check"). Do not change their words. Every check is off unless the user asks: fact_check (reads every claim against official sources, uses AI credits, and a wrong claim stops the post and saves it to Drafts with the issues), originality (paid plagiarism check), optimise (keeps their words and adds SEO; saved to Drafts for review, never posted), ask_reviewer (needs the CA/CPA reviewer name). Placeholders like [VERIFY] or [AUTHOR NAME] and AI notes always stop a post. mode "save" only saves to Drafts & Review. Only an admin or a manager can post live; for others use mode "save". content_html starts at <h2> or a paragraph (the title is printed as the H1).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content_html: { type: 'string', description: 'The whole article, HTML or plain text.' },
      meta_description: { type: 'string' },
      keyword: { type: 'string', description: 'Main keyword; defaults to the title.' },
      author: { type: 'string', description: 'Byline author; defaults to one of the blog authors.' },
      reviewer: { type: 'string', description: 'CA/CPA reviewer name, with ask_reviewer.' },
      mode: { type: 'string', enum: ['post', 'save'] },
      fact_check: { type: 'boolean' },
      originality: { type: 'boolean' },
      optimise: { type: 'boolean' },
      ask_reviewer: { type: 'boolean' },
      checklist: {
        type: 'object',
        description: 'Mode "post": the publish checklist. Set author, title, content and banner to true only after the user has checked each one (shown on the card) and said so.',
        properties: { author: { type: 'boolean' }, title: { type: 'boolean' }, content: { type: 'boolean' }, banner: { type: 'boolean' } },
        additionalProperties: false,
      },
    },
    required: ['title', 'content_html', 'mode'],
    additionalProperties: false,
  },
  summarize: (i) => {
    const checks = ['fact_check', 'originality', 'optimise', 'ask_reviewer'].filter((k) => i[k]).map((k) => k.replace('_', ' '));
    return `${i.mode === 'post' && !i.optimise ? 'Post live on the website' : 'Save to Drafts & Review'}: "${snippet(i.title, 80)}" (checks: ${checks.length ? checks.join(', ') : 'none'})`;
  },
  preview: async (i, ctx) => {
    const { articleHtml, wordCount } = await import('@/lib/myBlog');
    const { liveTextProblem, canPublishNow } = await import('@/lib/publishDraft');
    const html = articleHtml(i.content_html);
    const post = i.mode === 'post' && !i.optimise;
    const problems = [
      post && !(await canPublishNow(ctx?.me || null)) ? 'Your role cannot post live straight away; ask for mode "save" (Save to Drafts) instead.' : '',
      post ? liveTextProblem({ title: i.title, meta_description: i.meta_description, content_html: html }) || '' : '',
      wordCount(html) < 50 ? 'The blog has under 50 words.' : '',
      post && !i.author ? 'Posting live needs the author (one of the blog authors), so the user can check it.' : '',
      post && !['author', 'title', 'content', 'banner'].every((k) => i.checklist?.[k] === true) ? 'The publish checklist is not ticked: ask the user to check the author, title, text and banner shown here, then call again with checklist all true.' : '',
    ].filter(Boolean);
    return {
      target: `${post ? 'Live on the website' : 'Drafts & Review'}: ${i.title}`,
      words: wordCount(html),
      keyword: i.keyword || i.title,
      author: i.author || '(one of the blog authors)',
      checklist: i.mode === 'post' && !i.optimise ? { Author: i.author || '(none chosen)', Title: i.title, 'Blog text': `${wordCount(html)} words`, Banner: 'the branded cover made from the title and author', ticked: ['author', 'title', 'content', 'banner'].every((k) => i.checklist?.[k] === true) } : null,
      checks: ['fact_check', 'originality', 'optimise', 'ask_reviewer'].filter((k) => i[k]).join(', ') || 'none',
      warning: i.fact_check || i.originality || i.optimise ? 'The ticked checks use AI credits or paid lookups.' : null,
      problem: problems.length ? problems.join(' ') : null,
    };
  },
  run: async (i, ctx) => {
    if (i.fact_check) ctx.emit?.({ type: 'tool_progress', text: 'Fact checking every claim before posting (a few minutes)…' });
    const { postMyBlog } = await import('@/lib/myBlog');
    // A fact check waits for AI answers: in Testing mode they come from the Claude Code queue, so it runs in the background.
    if (i.fact_check) {
      const { runOrQueue } = await import('./tabTools');
      return runOrQueue(ctx, `Post my blog "${String(i.title).slice(0, 60)}" with a fact check`, 'Drafts & Review', () => postMyBlogResult(i, ctx, postMyBlog));
    }
    return postMyBlogResult(i, ctx, postMyBlog);
  },
});

async function postMyBlogResult(i, ctx, postMyBlog) {
  const r = await postMyBlog(
    { title: i.title, html: i.content_html, meta_description: i.meta_description, keyword: i.keyword, author: i.author, reviewer: i.reviewer, mode: i.mode, fact_check: i.fact_check, originality: i.originality, optimise: i.optimise, ask_reviewer: i.ask_reviewer, checklist: i.checklist },
    { me: ctx?.me || null, actor: ctx?.me?.name ? `${ctx.me.name} (assistant)` : 'Assistant' },
  );
  if (r.status !== 200 && !r.body?.draftId) throw new Error(r.body?.error || 'The blog could not be posted.');
  return {
    result: {
      draft_id: r.body.draftId ?? null,
      posted: Boolean(r.body.posted),
      url: r.body.url || null,
      message: r.body.message || r.body.error || null,
      issues: r.body.issues || [],
      notes: r.body.notes || [],
    },
  };
}

defineTool({
  name: 'list_audits',
  kind: 'read',
  description: 'List past blog audits (Blog Audit and Blog Renewal tabs) with verdict, issue count and rewrite status.',
  input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: [], additionalProperties: false },
  summarize: () => 'List blog audits',
  run: async ({ limit = 20 }) =>
    (
      await prisma.blog_audits.findMany({
        select: { id: true, title: true, source_url: true, verdict: true, summary: true, issues: true, rewrite_status: true, wp_post_id: true, created_at: true },
        orderBy: { id: 'desc' },
        take: limit,
      })
    ).map((a) => ({ ...a, issues: JSON.parse(a.issues || '[]').length })),
});

defineTool({
  name: 'get_activity_log',
  kind: 'read',
  description: 'Recent dashboard activity log entries (drafts generated, approvals, publishes, audits, assistant website changes).',
  input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, required: [], additionalProperties: false },
  summarize: () => 'Read activity log',
  run: async ({ limit = 30 }, ctx) =>
    prisma.activity_log.findMany({
      where: activityWhere(ctx?.me),
      select: { action: true, entity_type: true, entity_id: true, details: true, actor: true, created_at: true },
      orderBy: { id: 'desc' },
      take: limit,
    }),
});

defineTool({
  name: 'get_seo_strategy',
  kind: 'read',
  description: 'The currently approved monthly SEO strategy (what the dashboard is following) and the most recent one of any status.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read SEO strategy',
  run: async () => {
    const pick = (s: any) =>
      s && {
        id: s.id,
        period: s.period,
        status: s.status,
        summary: s.summary,
        approved_by: s.approved_by,
        approved_at: s.approved_at,
        plan: s.plan_json ? JSON.parse(s.plan_json) : null,
        created_at: s.created_at,
      };
    return {
      approved: pick(await prisma.seo_strategies.findFirst({ where: { status: 'approved' }, orderBy: { id: 'desc' } })) || null,
      latest: pick(await prisma.seo_strategies.findFirst({ orderBy: { id: 'desc' } })) || null,
    };
  },
});

defineTool({
  name: 'list_site_changes',
  kind: 'read',
  description: 'Website changes the assistant has made (newest first), including whether each was later undone.',
  input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: [], additionalProperties: false },
  summarize: () => 'List past website changes',
  run: async ({ limit = 20 }) =>
    prisma.site_changes.findMany({
      select: { id: true, tool: true, summary: true, target_type: true, target_id: true, status: true, created_at: true, undone_at: true },
      orderBy: { id: 'desc' },
      take: limit,
    }),
});

defineTool({
  name: 'search_console_queries',
  kind: 'read',
  description:
    'Google Search Console search queries for usaindiacfo.com over the last N days (clicks, impressions, CTR, average position). Optionally only queries containing a word or phrase.',
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'integer', minimum: 1, maximum: 480 },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      contains: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Search Console queries${i.contains ? ` containing "${i.contains}"` : ''}`,
  run: async ({ days = 28, limit = 25, contains }) => {
    const { current } = comparisonRanges(days);
    const rows = await querySearchAnalytics({
      ...current,
      dimensions: ['query'],
      rowLimit: limit,
      filters: contains ? [{ dimension: 'query', operator: 'contains', expression: contains }] : [],
    });
    return { range: current, rows: rows.map((r: any) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) };
  },
});

defineTool({
  name: 'search_console_pages',
  kind: 'read',
  description: 'Google Search Console performance by page URL over the last N days (clicks, impressions, CTR, position).',
  input_schema: {
    type: 'object',
    properties: { days: { type: 'integer', minimum: 1, maximum: 480 }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
    required: [],
    additionalProperties: false,
  },
  summarize: () => 'Search Console top pages',
  run: async ({ days = 28, limit = 25 }) => {
    const { current } = comparisonRanges(days);
    const rows = await querySearchAnalytics({ ...current, dimensions: ['page'], rowLimit: limit });
    return { range: current, rows: rows.map((r: any) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) };
  },
});

defineTool({
  name: 'ga4_overview',
  kind: 'read',
  description: 'Google Analytics 4 summary (active users, sessions, conversions, engagement rate) and top landing pages for the last N days.',
  input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, required: [], additionalProperties: false },
  summarize: () => 'Read GA4 analytics',
  run: async ({ days = 28 }) => {
    const [summary, topPages] = await Promise.all([getSummary(days), getTopLandingPages(days, 15)]);
    return { days, summary, topPages };
  },
});

defineTool({
  name: 'rank_tracking',
  kind: 'read',
  description: "Today's Google positions for every keyword tracked in SE Ranking, with daily change and search volume.",
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read SE Ranking positions',
  run: async () => {
    const sites = await listSites();
    if (!sites.length) return { rankings: [], note: 'No SE Ranking project found' };
    return { site: sites[0].title || sites[0].name, rankings: await getSiteRankings(sites[0].id) };
  },
});

defineTool({
  name: 'keyword_research',
  // A paid SE Ranking lookup: shown as a card first, like every step that spends money.
  kind: 'write',
  description:
    'SE Ranking keyword research for a seed keyword: similar, related, question-style, or long-tail keywords with volume, difficulty and CPC (US database). Uses SE Ranking units, so the person approves it first; ask for several seeds in one turn so they approve them together.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: { type: 'string' },
      type: { type: 'string', enum: ['similar', 'related', 'questions', 'longtail'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
  summarize: (i) => `Keyword research: "${i.keyword}" (${i.type || 'related'})`,
  preview: async () => ({ warning: 'Uses SE Ranking API units.' }),
  run: async ({ keyword, type = 'related', limit = 30 }) => {
    return { result: await researchKeywords(type, keyword, { limit }) };
  },
});

defineTool({
  name: 'serp_top_results',
  // A paid SerpHouse search: shown as a card first, like every step that spends money.
  kind: 'write',
  description:
    'Live Google results (SERPHouse) for a keyword in the US or India: the top organic results, where usaindiacfo.com ranks, the "People also ask" questions (use these for FAQ sections), related searches, and what the Google AI Overview says and cites. A paid search, so the person approves it first.',
  input_schema: {
    type: 'object',
    properties: { keyword: { type: 'string' }, market: { type: 'string', enum: ['US', 'India'], description: 'Default US.' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  summarize: (i) => `Live Google results for "${i.keyword}" (${i.market || 'US'})`,
  preview: async () => ({ warning: 'Uses one paid SerpHouse search.' }),
  run: async ({ keyword, market }) => {
    const json = await liveSearch({ q: keyword, loc: market === 'India' ? 'India' : 'United States' });
    const results = json.results?.results || {};
    const organic = results.organic || [];
    const ours = organic.find((r) => String(r.link || '').includes('usaindiacfo.com'));
    return { result: {
      keyword,
      market: market || 'US',
      ourPosition: ours ? ours.position : null,
      top: organic.slice(0, 10).map((r) => ({ position: r.position, title: decode(r.title), link: r.link, snippet: decode(r.snippet) })),
      peopleAlsoAsk: peopleAlsoAsk({ serp: json }).map((q) => q.question),
      relatedSearches: (results.related_search || []).map((r) => decode(r.title)),
      aiOverview: aiOverviewSummary(json),
    } };
  },
});

defineTool({
  name: 'clarity_overview',
  kind: 'read',
  description: 'Microsoft Clarity behaviour data for the last 3 days: sessions, rage clicks, dead clicks, scroll depth, JS errors, popular pages.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read Clarity behaviour data',
  run: async () => {
    return getInsights({ numOfDays: 3 });
  },
});

defineTool({
  name: 'pagespeed_check',
  kind: 'read',
  description: 'Run Google PageSpeed Insights on a URL: Lighthouse scores plus real-user Core Web Vitals (CrUX).',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string' }, strategy: { type: 'string', enum: ['mobile', 'desktop'] } },
    required: ['url'],
    additionalProperties: false,
  },
  summarize: (i) => `PageSpeed check: ${i.url} (${i.strategy || 'mobile'})`,
  run: async ({ url, strategy = 'mobile' }) => {
    return runPageSpeedCheck(url, strategy);
  },
});

defineTool({
  name: 'zoho_leads',
  kind: 'read',
  description: 'Zoho CRM lead counts by lead source and how many converted.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read Zoho CRM lead sources',
  run: async () => {
    return getLeadSourceBreakdown();
  },
});

defineTool({
  name: 'latest_technical_crawl',
  kind: 'read',
  description: 'The most recent Screaming Frog crawl imported into the dashboard: broken pages, missing or duplicate titles, missing meta descriptions, thin pages.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read latest technical crawl',
  run: async () => {
    const row = await prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });
    if (!row) return { note: 'No Screaming Frog crawl has been imported yet.' };
    return { ...row, problem_urls: JSON.parse(row.problem_urls || '[]').slice(0, 40) };
  },
});

// ---------------------------------------------------------------------------------------------
// Website - read only, through the website connection (nothing on the website is changed here)
// ---------------------------------------------------------------------------------------------

defineTool({
  name: 'website_search_posts',
  kind: 'read',
  description:
    'Find live blog posts on usaindiacfo.com whose title shares words with the query. Returns id, title, link, last modified. Read only.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words from the title; omit to list the most recent' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Search the website's posts${i.query ? ` for "${i.query}"` : ''}`,
  run: async ({ query, limit = 20 }) => {
    const posts = query ? await searchPosts(query, limit, { full: false }) : (await livePosts()).sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || ''))).slice(0, limit);
    return posts.map((p) => ({ id: p.id, title: decode(p.title), slug: p.slug, link: p.link, modified: p.modified }));
  },
});

defineTool({
  name: 'website_get_post',
  kind: 'read',
  description: 'Read one live blog post on usaindiacfo.com (by id from website_search_posts, or by its address): title, content, SEO title, meta description, focus keyphrase, cover image. Read only.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, url: { type: 'string' } },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Read website post ${i.id ? `#${i.id}` : i.url || ''}`.trim(),
  run: async ({ id, url }) => {
    if (!id && !url) throw new Error('Give the post id or its address.');
    const p = id ? await getPost(id) : await findPostByUrl(url);
    return { ...p, content_length: p.content.length };
  },
});

// ---------------------------------------------------------------------------------------------
// Dashboard actions (write)
// ---------------------------------------------------------------------------------------------

defineTool({
  name: 'add_keywords_to_pipeline',
  kind: 'write',
  risk: 'low',
  description: 'Add keywords to the dashboard blog pipeline (they become "pending" and get written one at a time with "Generate next blog draft").',
  input_schema: {
    type: 'object',
    properties: { keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 }, batch_name: { type: 'string' } },
    required: ['keywords'],
    additionalProperties: false,
  },
  summarize: (i) => `Add ${i.keywords.length} keyword(s) to the blog pipeline: ${i.keywords.slice(0, 5).join(', ')}${i.keywords.length > 5 ? '…' : ''}`,
  run: async (i) => {
    const ids: number[] = [];
    for (const k of i.keywords) {
      const kw = String(k).trim();
      if (kw) ids.push((await prisma.keywords.create({ data: { batch_name: i.batch_name || 'Assistant', keyword: kw, notes: '', status: 'pending' } })).id);
    }
    return {
      result: { added: ids.length },
      change: { summary: `Added ${ids.length} keyword(s) to the pipeline`, targetType: 'keywords', targetId: ids.join(','), undo: { kind: 'delete_pending_keywords', ids } },
    };
  },
});

defineTool({
  name: 'save_people_also_ask',
  kind: 'write',
  risk: 'low',
  description:
    'Save Google "People also ask" questions into the dashboard question bank, e.g. questions read from a screenshot the user attached. The question bank feeds FAQ sections and the monthly strategy report. Copy each question exactly as Google shows it.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'The search the questions appeared for.' },
      market: { type: 'string', enum: ['US', 'India', 'unknown'] },
      questions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 },
    },
    required: ['keyword', 'questions'],
    additionalProperties: false,
  },
  summarize: (i) => `Save ${i.questions.length} "People also ask" question(s) for "${i.keyword}"`,
  preview: async (i) => ({ questions: i.questions.slice(0, 30).join(' | ') }),
  run: async (i) => {
    const keyOf = (q) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const questions = i.questions.map((q) => String(q).trim());
    const keys = [...new Set(questions.map(keyOf))];
    const market = i.market && i.market !== 'unknown' ? [i.market] : [];
    // The reads before and after the save and the save itself are synchronous, so nothing else can
    // record a sighting in between: the difference is exactly what this save did.
    // PORT NOTE: these are now awaited DB calls (Postgres); the logic is unchanged.
    const before = new Map<any, any>((await paaRows(keys)).map((r: any) => [r.question_key, r]));
    await recordQuestions(i.keyword, questions.map((q) => ({ question: q, markets: market })));
    const stored = await paaRows(keys);
    // One entry per row this save created or changed, with its state before and after, so the undo
    // can take back exactly this save and nothing recorded later.
    const rows = stored
      .map((after) => {
        const prev = before.get(after.question_key);
        return { id: after.id, added: after.times_seen - (prev ? prev.times_seen : 0), before: prev ? paaState(prev) : null, after: paaState(after) };
      })
      .filter((r) => !r.before || !samePaaState(r.before, r.after));
    const created = rows.filter((r) => !r.before).length;
    return {
      result: { saved: stored.length, new: created, alreadyKnown: stored.length - created, skipped: keys.length - stored.length },
      change: {
        summary: `Saved ${rows.length} People also ask question(s) for "${i.keyword}"`,
        targetType: 'question_bank',
        targetId: rows.map((r) => r.id).join(','),
        undo: rows.length ? { kind: 'restore_paa_questions', rows } : null,
      },
    };
  },
});

async function paaRows(keys): Promise<any[]> {
  if (!keys.length) return [];
  return prisma.paa_questions.findMany({
    where: { question_key: { in: keys } },
    select: { id: true, question_key: true, keyword: true, markets: true, times_seen: true, last_seen: true },
  });
}

function paaState(row) {
  return { keyword: row.keyword, markets: row.markets, times_seen: row.times_seen, last_seen: row.last_seen };
}

function samePaaState(a, b) {
  return a.keyword === b.keyword && a.markets === b.markets && a.times_seen === b.times_seen && a.last_seen === b.last_seen;
}

// Takes back only what one save_people_also_ask recorded. A question it added is deleted unless
// something else (a research brief, the monthly AI Overview check) has seen it since, in which case
// the row stays with this save's count taken off. A question that already existed gets its earlier
// keyword, markets, count and date back, or, if it was seen again since, just its count lowered.
async function undoPaaSave(rows) {
  const get = (id) =>
    prisma.paa_questions.findUnique({
      where: { id },
      select: { id: true, keyword: true, markets: true, times_seen: true, first_seen: true, last_seen: true },
    });
  let removed = 0;
  let kept = 0;
  let restored = 0;
  for (const row of rows) {
    const now = row && Number.isInteger(row.id) && Number.isInteger(row.added) && row.added >= 0 && row.after ? await get(row.id) : null;
    if (!now) continue;
    const untouched = samePaaState(now, row.after);
    const left = Math.max(1, now.times_seen - row.added);
    if (!row.before && untouched) {
      await prisma.paa_questions.delete({ where: { id: row.id } });
      removed++;
    } else if (!row.before) {
      // Kept for the later sightings. When only one is left, it is also the first one.
      await prisma.paa_questions.update({ where: { id: row.id }, data: { times_seen: left, first_seen: left === 1 ? now.last_seen : now.first_seen } });
      kept++;
    } else if (untouched) {
      await prisma.paa_questions.update({
        where: { id: row.id },
        data: { keyword: row.before.keyword, markets: row.before.markets, times_seen: row.before.times_seen, last_seen: row.before.last_seen },
      });
      restored++;
    } else {
      await prisma.paa_questions.update({ where: { id: row.id }, data: { times_seen: left } });
      restored++;
    }
  }
  const parts = [`removed ${removed} new question(s)`, `restored ${restored} existing question(s)`];
  if (kept) parts.push(`kept ${kept} new question(s) that were seen again elsewhere since`);
  return `In the question bank: ${parts.join(', ')}.`;
}

defineTool({
  name: 'question_bank',
  kind: 'read',
  description: 'The Google "People also ask" question bank: questions seen for a keyword (search), or the newest and most frequent ones.',
  input_schema: { type: 'object', properties: { search: { type: 'string' } }, required: [], additionalProperties: false },
  summarize: (i) => (i.search ? `Search the question bank for "${i.search}"` : 'Read the question bank'),
  run: async ({ search }) => {
    if (search) {
      const like = String(search).toLowerCase();
      return prisma.paa_questions.findMany({
        where: { OR: [{ question: { contains: like, mode: 'insensitive' } }, { keyword: { contains: like, mode: 'insensitive' } }] },
        select: { question: true, keyword: true, markets: true, times_seen: true, first_seen: true },
        orderBy: { times_seen: 'desc' },
        take: 50,
      });
    }
    return questionBankSummary(30);
  },
});

defineTool({
  name: 'run_blog_audit',
  kind: 'write',
  risk: 'low',
  description:
    'Run the full SEO/AEO/GEO + fact-check audit on a blog (pasted HTML/text, a public URL, or a live website post id from website_search_posts). Works for any blog, including someone else\'s. Takes 1-2 minutes and uses AI credits. The result appears in the Blog Audit tab, where the user can generate the rewrite, see what changed and why, and download it as Word.',
  input_schema: {
    type: 'object',
    properties: {
      content_html: { type: 'string' },
      source_url: { type: 'string' },
      post_id: { type: 'integer', description: 'A live post on the website (id from website_search_posts).' },
      title: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Run a blog audit on ${i.post_id ? `website post #${i.post_id}` : i.source_url ? i.source_url : 'the pasted blog'}`,
  run: async (i, ctx) => {
    ctx.emit?.({ type: 'tool_progress', text: 'Auditing the blog (researching every claim, 1-2 minutes)…' });
    // Testing mode: the audit's AI steps wait for Claude Code, so it runs as Check a blog runs it.
    const { aiMode } = await import('@/lib/aiQueue');
    if ((await aiMode()) === 'testing') {
      const { startAudit } = await import('@/lib/auditJobs');
      const row: any = await startAudit({ title: i.title, contentHtml: i.content_html, sourceUrl: i.source_url, wpPostId: i.post_id, actor: ctx?.me?.name ? `${ctx.me.name} (assistant)` : 'Assistant' });
      return { result: { audit_id: row.id, started: true, note: 'Testing mode: the audit runs in the background and its AI steps wait in the Claude Code queue. See it in Check a blog (or audit_get) when Claude Code has answered.' } };
    }
    const audit = await createAudit({ title: i.title, contentHtml: i.content_html, sourceUrl: i.source_url, wpPostId: i.post_id });
    return {
      result: {
        audit_id: audit.id,
        verdict: audit.verdict,
        summary: audit.summary,
        issues: audit.issues,
        suggestions: audit.suggestions,
        next_step: 'Tell the user to open the Blog Audit tab, click Open on this audit, then "Rewrite to fix these issues" and "Download as Word".',
      },
    };
  },
});

// Pictures for a Word file. The converter would fetch every http(s) image from the server, so only
// pictures already inside the HTML (data:) or stored on the dashboard (/api/uploads/..., and only
// files this member may read) are kept; those are embedded. Every other <img> is dropped.
export async function docImages(html: string, me: any): Promise<string> {
  const { readFile, mimeFor } = await import('@/lib/storage');
  const { canReadAssistantFile } = await import('./fileAccess');
  const out: string[] = [];
  let last = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    out.push(html.slice(last, m.index));
    last = m.index! + m[0].length;
    const tag = m[0].replace(/\s(srcset|sizes)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const src = (tag.match(/\ssrc=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find((v) => v !== undefined) || '';
    if (/^data:image\//i.test(src)) {
      out.push(tag);
      continue;
    }
    const up = src.match(/^\/api\/uploads\/([A-Za-z0-9._\/%-]+)$/);
    let key = '';
    try {
      key = up ? decodeURIComponent(up[1]) : '';
    } catch {}
    if (!key || key.includes('..') || key.startsWith('/') || !(await canReadAssistantFile(me, key))) continue;
    const buf = await readFile(key).catch(() => null);
    if (!buf) continue;
    out.push(tag.replace(src, `data:${mimeFor(key)};base64,${buf.toString('base64')}`));
  }
  out.push(html.slice(last));
  return out.join('');
}

// A Word file made in the chat: the document the user asked for (a blog with SEO and links added, a
// report, notes), saved privately for this member and linked in the reply. Nothing goes to the website.
defineTool({
  name: 'make_word_file',
  kind: 'read',
  description:
    'Make a Word (.docx) file and give the user a download link in this chat. Use it whenever the user asks for a document, a Word file or a downloadable version (for example their blog with SEO, internal links and backlinks added). Put the COMPLETE document in html (headings as <h2>/<h3>, paragraphs, lists, tables, links as <a href>). Then reply with the link exactly as returned, as a markdown link. Never deliver a document by saving it to the website or any draft there.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title, used as the file name and the first heading.' },
      html: { type: 'string', description: 'The full document body as HTML.' },
    },
    required: ['title', 'html'],
    additionalProperties: false,
  },
  summarize: (i) => `Make a Word file: ${i.title || 'document'}`,
  run: async (i, ctx) => {
    const html = String(i.html || '');
    if (html.replace(/<[^>]+>/g, ' ').trim().length < 20) throw new Error('The document is empty: put the full text in html.');
    const title = String(i.title || 'Document').trim().slice(0, 150) || 'Document';
    const { htmlToDocx } = await import('@/lib/docx');
    const { saveFile } = await import('@/lib/storage');
    const { ownerStamp } = await import('./conversations');
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const buf = await htmlToDocx(`<h1>${esc(title)}</h1>${await docImages(html, ctx?.me)}`);
    const filename = `${title.replace(/[^a-z0-9 ._-]+/gi, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'document'}.docx`;
    const key = `assistant/docs/${Date.now()}-${filename}`;
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await saveFile(key, buf, DOCX);
    await prisma.assistant_files.create({ data: { kind: 'document', filename, path: key, mime: DOCX, size: buf.length, uploaded_by: ownerStamp(ctx?.me, null) } });
    const url = `/api/uploads/${key}`;
    return { filename, url, link_markdown: `[Download ${filename}](${url})`, note: 'Give the user link_markdown exactly as written.' };
  },
});

// ---------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------

async function undoChange(undo, { force = false }: { force?: boolean } = {}) {
  switch (undo.kind) {
    case 'restore_site_post': {
      // A technical fix on a website post (lib/strategy/fixer.ts): the saved fields go back.
      const { updatePost, getPost, postFieldsHash } = await import('@/lib/site');
      if (undo.expectHash && !force) {
        const current = await getPost(undo.id);
        if (postFieldsHash(current, Object.keys(undo.fields || {})) !== undo.expectHash) {
          const err: any = new Error('This post was changed on the website after this fix. Undoing now would also remove those later changes.');
          err.code = 'CHANGED_SINCE';
          throw err;
        }
      }
      await updatePost(undo.id, undo.fields || {});
      return 'Restored the previous version on the website.';
    }
    // Changes made on the old website before the move to the custom site cannot be reversed here.
    case 'restore_fields':
    case 'trash':
    case 'untrash':
    case 'delete_media':
    case 'restore_media_fields':
    case 'restore_settings':
    case 'delete_menu_item':
    case 'restore_menu_item':
    case 'recreate_menu_item':
    case 'delete_term':
    case 'plugin_status':
    case 'delete_plugin':
      throw new Error('This change was made on the old website, which the dashboard no longer reaches, so it cannot be undone from here.');
    case 'restore_paa_questions':
      return await undoPaaSave(undo.rows || []);
    case 'delete_paa_questions': {
      // Older saves recorded only the ids of the questions they added, each seen once by the save.
      const ids = (undo.ids || []).filter((n) => Number.isInteger(n));
      if (!ids.length) return 'Nothing to remove.';
      const removed = (await prisma.paa_questions.deleteMany({ where: { times_seen: { lte: 1 }, id: { in: ids } } })).count;
      const kept = (await prisma.paa_questions.updateMany({ where: { times_seen: { gt: 1 }, id: { in: ids } }, data: { times_seen: { decrement: 1 } } })).count;
      return `Removed ${removed} question(s) from the question bank${kept ? ` and kept ${kept} that were seen again elsewhere since` : ''}.`;
    }
    case 'restore_draft': {
      const draft: any = await prisma.drafts.findUnique({ where: { id: undo.id } });
      if (!draft) throw new Error('That draft no longer exists.');
      if (undo.expectHash && !force) {
        const now = Object.fromEntries(Object.keys(undo.fields).map((k) => [k, draft[k] ?? null]));
        if (draftHash(now) !== undo.expectHash) {
          const err: any = new Error('This draft was edited again after this change. Undoing now would also remove those later edits.');
          err.code = 'CHANGED_SINCE';
          throw err;
        }
      }
      // The word count goes back with the text, counted the same way saveDraftFields does.
      const counted = undo.fields.content_html != null ? { word_count: String(undo.fields.content_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length } : {};
      await prisma.drafts.update({ where: { id: undo.id }, data: { ...undo.fields, ...counted, updated_at: sqlNow() } });
      return 'Restored the previous version of the draft.';
    }
    case 'delete_pending_keywords': {
      const ids = (undo.ids || []).filter((n) => Number.isInteger(n));
      if (!ids.length) return 'Nothing to remove.';
      const r = await prisma.keywords.deleteMany({ where: { status: 'pending', id: { in: ids } } });
      return `Removed ${r.count} pending keyword(s).`;
    }
    default:
      throw new Error(`Cannot undo change of kind "${undo.kind}"`);
  }
}

// ---------------------------------------------------------------------------------------------
// Input validation (inputs stream eagerly, so the API does not validate them for us)
// ---------------------------------------------------------------------------------------------

function validate(schema: any, value: any, path = 'input'): string | null {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) return `${path}.${key} is required`;
    }
    for (const [key, v] of Object.entries(value)) {
      const propSchema = schema.properties?.[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) return `${path}.${key} is not a known field`;
        continue;
      }
      const err = validate(propSchema, v, `${path}.${key}`);
      if (err) return err;
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.minItems && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s)`;
    if (schema.maxItems && value.length > schema.maxItems) return `${path} allows at most ${schema.maxItems} item(s)`;
    for (let n = 0; n < value.length; n++) {
      const err = validate(schema.items || {}, value[n], `${path}[${n}]`);
      if (err) return err;
    }
    return null;
  }
  if (schema.type === 'string' && typeof value !== 'string') return `${path} must be a string`;
  if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`;
  if (schema.type === 'number' && typeof value !== 'number') return `${path} must be a number`;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} must be true or false`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of: ${schema.enum.join(', ')}`;
  if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
  if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
  return null;
}

// The tools for the work each dashboard tab does (lib/assistant/tabTools.ts).
for (const t of TAB_TOOLS) defineTool(t);

function getTool(name) {
  return TOOLS.find((t) => t.name === name);
}

// Read tools that show what the asker's role may not open directly: the same action the matching
// dashboard route or page needs (reports, paid SE Ranking / SerpHouse lookups, content work). The engine refuses them
// for a person without it.
const READ_NEEDS: Record<string, Action> = {
  search_console_queries: 'reports.view',
  search_console_pages: 'reports.view',
  ga4_overview: 'reports.view',
  rank_tracking: 'reports.view',
  clarity_overview: 'reports.view',
  pagespeed_check: 'reports.view',
  zoho_leads: 'reports.view',
  // Content work (unpublished drafts, audits, the keyword pipeline, site changes): hidden pages for a
  // role without content work.
  list_drafts: 'content.work',
  get_draft: 'content.work',
  list_audits: 'content.work',
  list_keywords: 'content.work',
  list_site_changes: 'content.work',
  latest_technical_crawl: 'reports.view',
};

// Write tools: the permission the person needs, checked when the card is shown and again for the
// person who approves it, the same action the matching dashboard route needs. A tool in
// lib/assistant/tabTools.ts names its own ("needs"). A write tool named nowhere needs website.change,
// so a new tool is never open to everyone by mistake.
const WRITE_NEEDS: Record<string, Action | Action[]> = {
  draft_edit_text: 'content.work',
  draft_update_fields: 'content.work',
  // Post my blog: content work to save; posting live is checked again (blog.publish_now) in lib/myBlog.ts.
  post_my_blog: 'content.work',
  add_keywords_to_pipeline: 'content.work',
  save_people_also_ask: 'content.work',
  run_blog_audit: 'content.work',
  // Paid lookups (SE Ranking units, SerpHouse searches), open to the roles that see reports.
  keyword_research: 'reports.view',
  serp_top_results: 'reports.view',
};

// Every action a tool needs for this input (all of them are required).
function toolNeeds(name: string, input: any = {}): Action[] {
  const tool = getTool(name);
  const own = tool?.needs ? (typeof tool.needs === 'function' ? tool.needs(input || {}) : tool.needs) : null;
  const needs = own || READ_NEEDS[name] || WRITE_NEEDS[name] || (tool?.kind === 'write' ? 'website.change' : null);
  return needs ? (Array.isArray(needs) ? needs : [needs]) : [];
}

// The first action this person may not do for this tool, or null when every one is open to them.
async function missingNeed(me: any, name: string, input: any): Promise<Action | null> {
  const { canDo } = await import('@/lib/access');
  for (const need of toolNeeds(name, input)) {
    if (!(me && (me.role === 'admin' || (await canDo(me, need))))) return need;
  }
  return null;
}

// Like the Activity Log page: an admin sees everyone's work, everyone else their own.
function activityWhere(me: { email: string; role: string } | null | undefined) {
  if (me?.role === 'admin') return undefined;
  return { actor_email: me?.email || '' };
}

function riskOf(tool, input) {
  return tool.riskFor ? tool.riskFor(input) : tool.risk;
}

function serializeResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated, ${text.length - MAX_RESULT_CHARS} more characters]` : text;
}

const API_TOOLS: any[] = [
  ...TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true })),
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
];

export { TOOLS, API_TOOLS, getTool, toolNeeds, missingNeed, validate, riskOf, serializeResult, undoChange };

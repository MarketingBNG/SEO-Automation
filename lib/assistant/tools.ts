import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { wpRequest, uploadMedia, refreshYoast } from '@/lib/wordpress';
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

// Every tool is either 'read' (runs immediately) or 'write' (only runs after the human approves
// it in the dashboard). A write tool's run() returns { result, change } where change describes how
// to reverse it; the engine records that in site_changes so the dashboard can offer Undo.

const TYPE_ROUTES: Record<string, string> = { post: '/wp/v2/posts', page: '/wp/v2/pages' };
const MAX_RESULT_CHARS = 40000;

function route(type) {
  const r = TYPE_ROUTES[type];
  if (!r) throw new Error(`type must be "post" or "page", got "${type}"`);
  return r;
}

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

function decode(str) {
  return String(str || '')
    .replace(/&#8212;/g, '-')
    .replace(/&#8211;/g, '-')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"');
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

// Top-level WPBakery rows ([vc_row]...[/vc_row]); inner rows use [vc_row_inner] so rows don't nest.
function wpbakeryRows(content) {
  const rows: any[] = [];
  const openRe = /\[vc_row(?=[\s\]])/g;
  let match;
  while ((match = openRe.exec(content))) {
    const start = match.index;
    const closeIdx = content.indexOf('[/vc_row]', start);
    if (closeIdx === -1) break;
    const end = closeIdx + '[/vc_row]'.length;
    const body = content.slice(start, end);
    rows.push({
      index: rows.length,
      start,
      end,
      text: snippet(body, 140),
      images: (body.match(/vc_single_image|<img\s/g) || []).length,
    });
    openRe.lastIndex = end;
  }
  return rows;
}

function isWpbakery(content) {
  return /\[vc_row[\s\]]/.test(content || '');
}

async function getRaw(type, id) {
  const { json } = await wpRequest('GET', `${route(type)}/${id}`, { query: { context: 'edit' } });
  return {
    id: json.id,
    type,
    title: json.title?.raw ?? '',
    content: json.content?.raw ?? '',
    excerpt: json.excerpt?.raw ?? '',
    slug: json.slug,
    status: json.status,
    link: json.link,
    featured_media: json.featured_media,
    categories: json.categories,
    tags: json.tags,
    parent: json.parent,
    modified: json.modified,
    meta: json.meta || {},
  };
}

function insertionIndex(content, { position, row_index, anchor_text }: any) {
  if (position === 'top') return 0;
  if (position === 'bottom') return content.length;
  if (position === 'before_row' || position === 'after_row') {
    const rows = wpbakeryRows(content);
    if (!rows.length) throw new Error('This content has no WPBakery rows; use top, bottom, before_text or after_text.');
    const row = rows[row_index];
    if (!row) throw new Error(`row_index ${row_index} does not exist (this page has ${rows.length} rows, 0-${rows.length - 1}).`);
    return position === 'before_row' ? row.start : row.end;
  }
  if (position === 'before_text' || position === 'after_text') {
    const n = countOccurrences(content, anchor_text);
    if (n === 0) throw new Error('anchor_text was not found in the raw content. Copy it exactly from wp_get_content.');
    if (n > 1) throw new Error(`anchor_text appears ${n} times; use a longer, unique anchor.`);
    const idx = content.indexOf(anchor_text);
    return position === 'before_text' ? idx : idx + anchor_text.length;
  }
  throw new Error(`Unknown position "${position}"`);
}

function contextAround(content, idx, radius = 120) {
  return {
    before: content.slice(Math.max(0, idx - radius), idx),
    after: content.slice(idx, idx + radius),
  };
}

function fieldDiffPreview(before, after) {
  const rows: any[] = [];
  for (const [key, next] of Object.entries(after)) {
    const prev = before[key];
    if (key === 'content') {
      rows.push({ field: 'content', before: `${String(prev || '').length} characters`, after: `${String(next || '').length} characters` });
    } else {
      rows.push({ field: key, before: prev === undefined ? '' : JSON.stringify(prev), after: JSON.stringify(next) });
    }
  }
  return rows;
}

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const TOOLS: any[] = [];
// Reviewer placeholders the writing playbook uses. They are fine in a WordPress draft, but must
// never reach a live page, so any website write that would put one on a public page is refused.
const PLACEHOLDER = /\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i;
const PLACEHOLDER_ALL = /\[(?:PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)[^\]\n]{0,160}\]?/gi;
// Statuses visitors can see ('future' goes live by itself on its scheduled date).
const PUBLIC_STATUSES = new Set(['publish', 'future']);
const PLACEHOLDER_HELP =
  'Replace each one with the real text first (ask the user for it if you do not have it), or keep the post as a draft. Placeholders are fine in draft, pending and private posts.';

function countPlaceholders(texts) {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const m of String(t || '').match(PLACEHOLDER_ALL) || []) counts.set(m, (counts.get(m) || 0) + 1);
  }
  return counts;
}

// What visitors and search engines see of a post or page.
function publicTexts(post) {
  const meta = post.meta || {};
  return [post.title, post.content, post.excerpt, meta._yoast_wpseo_title, meta._yoast_wpseo_metadesc];
}

// Placeholders this write would newly show on a public page. It checks the post as it will be
// after the write (current fields with the new ones applied, and the resulting status), not the
// tool input, so publishing a draft or restoring a revision is caught, while replacing a
// placeholder or editing a draft is not blocked. Placeholders that were already live before the
// change are not counted again, so they can be filled in one at a time.
function newPublicPlaceholders(current, body) {
  const before = current || {};
  const status = body.status ?? before.status ?? 'draft';
  if (!PUBLIC_STATUSES.has(status)) return [];
  const after = { ...before, ...body, meta: { ...(before.meta || {}), ...(body.meta || {}) } };
  const live = PUBLIC_STATUSES.has(before.status) ? countPlaceholders(publicTexts(before)) : new Map();
  const found: string[] = [];
  for (const [text, n] of countPlaceholders(publicTexts(after))) if (n > (live.get(text) || 0)) found.push(text);
  return found;
}

function placeholderProblem(current, body) {
  const found = newPublicPlaceholders(current, body);
  if (!found.length) return null;
  const list = found.slice(0, 5).map((t) => `"${t}"`).join(', ');
  return `This would put reviewer placeholders on a live page: ${list}${found.length > 5 ? ` and ${found.length - 5} more` : ''}. ${PLACEHOLDER_HELP}`;
}

// Every post and page write goes through these two, so the placeholder rule is always checked
// against what the page will really contain afterwards.
async function savePost(type, id, current, body) {
  const problem = placeholderProblem(current, body);
  if (problem) throw new Error(problem);
  return wpRequest('POST', `${route(type)}/${id}`, { body });
}

async function createPost(type, body) {
  const problem = placeholderProblem(null, body);
  if (problem) throw new Error(problem);
  return wpRequest('POST', route(type), { body });
}

// Other website writes (media details, menus, categories and tags, site settings) have no draft
// state and are public at once, so their text inputs are checked directly. Tools that write posts
// or pages set postWrite and are checked on their final state by savePost / createPost instead.
function placeholderGuard(tool) {
  if (tool.kind !== 'write' || !tool.name.startsWith('wp_') || tool.postWrite) return tool;
  const run = tool.run;
  return {
    ...tool,
    run: async (input, ctx) => {
      const texts = Object.values(input || {}).filter((v) => typeof v === 'string');
      if (texts.some((t) => PLACEHOLDER.test(t))) {
        throw new Error(
          'This text still contains a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]), and this change is public as soon as it runs. Ask the user for the real text, then try again.'
        );
      }
      return run(input, ctx);
    },
  };
}

function defineTool(tool: any) {
  TOOLS.push(placeholderGuard({ risk: 'low', ...tool }));
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
  run: async () => ({
    keywords: (await (prisma.keywords as any).groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } })).map((r: any) => ({ status: r.status, count: r._count._all })),
    drafts: (await (prisma.drafts as any).groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } })).map((r: any) => ({ status: r.status, count: r._count._all })),
    audits: await prisma.blog_audits.count(),
    meetingInsightsPendingReview: await prisma.client_insights.count({ where: { status: 'pending_review' } }),
    latestStrategy: (await prisma.seo_strategies.findFirst({ select: { id: true, period: true, status: true, created_at: true }, orderBy: { id: 'desc' } })) || null,
    activeWritingSkill: (await prisma.writing_skills.findFirst({ where: { status: 'active' }, select: { id: true, created_at: true }, orderBy: { id: 'desc' } })) || null,
    recentActivity: await prisma.activity_log.findMany({ select: { action: true, details: true, actor: true, created_at: true }, orderBy: { id: 'desc' }, take: 10 }),
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
  description: 'List AI-written blog drafts with their review status (pending_review, approved, rejected, published) and quality state.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['in_progress', 'pending_review', 'approved', 'rejected', 'published'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `List drafts${i.status ? ` (${i.status})` : ''}`,
  run: async ({ status, limit = 20 }) => {
    const cols = { id: true, title: true, status: true, production_state: true, word_count: true, wp_post_url: true, created_at: true };
    return prisma.drafts.findMany({ where: status ? { status } : {}, select: cols, orderBy: { id: 'desc' }, take: limit });
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
  run: async ({ limit = 30 }) =>
    prisma.activity_log.findMany({
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
        keyword_priorities: JSON.parse(s.keyword_priorities || '[]'),
        content_recommendations: JSON.parse(s.content_recommendations || '[]'),
        technical_recommendations: JSON.parse(s.technical_recommendations || '[]'),
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
  kind: 'read',
  description:
    'SE Ranking keyword research for a seed keyword: similar, related, question-style, or long-tail keywords with volume, difficulty and CPC (US database).',
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
  run: async ({ keyword, type = 'related', limit = 30 }) => {
    return researchKeywords(type, keyword, { limit });
  },
});

defineTool({
  name: 'serp_top_results',
  kind: 'read',
  description:
    'Live Google results (SERPHouse) for a keyword in the US or India: the top organic results, where usaindiacfo.com ranks, the "People also ask" questions (use these for FAQ sections), related searches, and what the Google AI Overview says and cites.',
  input_schema: {
    type: 'object',
    properties: { keyword: { type: 'string' }, market: { type: 'string', enum: ['US', 'India'], description: 'Default US.' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  summarize: (i) => `Live Google results for "${i.keyword}" (${i.market || 'US'})`,
  run: async ({ keyword, market }) => {
    const json = await liveSearch({ q: keyword, loc: market === 'India' ? 'India' : 'United States' });
    const results = json.results?.results || {};
    const organic = results.organic || [];
    const ours = organic.find((r) => String(r.link || '').includes('usaindiacfo.com'));
    return {
      keyword,
      market: market || 'US',
      ourPosition: ours ? ours.position : null,
      top: organic.slice(0, 10).map((r) => ({ position: r.position, title: decode(r.title), link: r.link, snippet: decode(r.snippet) })),
      peopleAlsoAsk: peopleAlsoAsk({ serp: json }).map((q) => q.question),
      relatedSearches: (results.related_search || []).map((r) => decode(r.title)),
      aiOverview: aiOverviewSummary(json),
    };
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
// Website (WordPress) - read
// ---------------------------------------------------------------------------------------------

defineTool({
  name: 'wp_search_content',
  kind: 'read',
  description:
    'Find blog posts and/or pages on usaindiacfo.com by keyword (searches titles and content). Returns id, type, title, status, link, last modified. Use this to find the id before reading or editing anything.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text; omit to list the most recent' },
      type: { type: 'string', enum: ['post', 'page', 'any'] },
      per_page: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Search website ${i.type && i.type !== 'any' ? `${i.type}s` : 'content'}${i.query ? ` for "${i.query}"` : ''}`,
  run: async ({ query, type = 'any', per_page = 20 }) => {
    const types = type === 'any' ? ['post', 'page'] : [type];
    const out: any[] = [];
    for (const t of types) {
      const { json } = await wpRequest('GET', route(t), {
        query: {
          search: query,
          per_page,
          status: 'publish,draft,pending,private,future',
          orderby: query ? 'relevance' : 'modified',
          _fields: 'id,title,link,status,modified,slug',
        },
      });
      for (const p of json as any[]) out.push({ id: p.id, type: t, title: decode(p.title?.rendered), status: p.status, slug: p.slug, link: p.link, modified: p.modified });
    }
    return out;
  },
});

defineTool({
  name: 'wp_get_content',
  kind: 'read',
  description:
    'Read one post or page exactly as stored (raw content, not rendered), plus title, slug, status, excerpt, featured image id, categories, tags and Yoast SEO fields if exposed. Pages built with WPBakery also get an outline of their top-level rows (row_index + text preview) so you can target an insertion point. ALWAYS read before editing.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['post', 'page'] } },
    required: ['id', 'type'],
    additionalProperties: false,
  },
  summarize: (i) => `Read ${i.type} #${i.id}`,
  run: async ({ id, type }) => {
    const raw = await getRaw(type, id);
    const builder = isWpbakery(raw.content) ? 'wpbakery' : 'html';
    const yoast = Object.fromEntries(Object.entries(raw.meta).filter(([k]) => k.startsWith('_yoast')));
    return {
      ...raw,
      meta: undefined,
      yoast: Object.keys(yoast).length ? yoast : 'not exposed via REST (the one-time Yoast REST snippet is not installed)',
      builder,
      outline: builder === 'wpbakery' ? wpbakeryRows(raw.content).map(({ index, text, images }) => ({ row_index: index, text, images })) : undefined,
      content_length: raw.content.length,
    };
  },
});

defineTool({
  name: 'wp_list_media',
  kind: 'read',
  description: 'Search the WordPress Media Library (images) by keyword. Returns id, title, URL, alt text, dimensions.',
  input_schema: {
    type: 'object',
    properties: { search: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Search media library${i.search ? ` for "${i.search}"` : ''}`,
  run: async ({ search, per_page = 20 }) => {
    const { json } = await wpRequest('GET', '/wp/v2/media', {
      query: { search, per_page, _fields: 'id,title,source_url,alt_text,mime_type,date,media_details' },
    });
    return json.map((m) => ({
      id: m.id,
      title: decode(m.title?.rendered),
      url: m.source_url,
      alt_text: m.alt_text,
      mime_type: m.mime_type,
      width: m.media_details?.width,
      height: m.media_details?.height,
      date: m.date,
    }));
  },
});

defineTool({
  name: 'wp_list_menus',
  kind: 'read',
  description: 'List navigation menus and which theme location each one is assigned to (e.g. the header menu).',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'List website menus',
  run: async () => (await wpRequest('GET', '/wp/v2/menus', { query: { _fields: 'id,name,locations', per_page: 100 } })).json,
});

defineTool({
  name: 'wp_get_menu_items',
  kind: 'read',
  description: 'List the items of one navigation menu: id, title, URL, parent item, order.',
  input_schema: { type: 'object', properties: { menu_id: { type: 'integer' } }, required: ['menu_id'], additionalProperties: false },
  summarize: (i) => `Read menu #${i.menu_id}`,
  run: async ({ menu_id }) => {
    const { json } = await wpRequest('GET', '/wp/v2/menu-items', {
      query: { menus: menu_id, per_page: 100, _fields: 'id,title,url,parent,menu_order,object,object_id,type' },
    });
    return json.map((m) => ({ ...m, title: decode(m.title?.rendered ?? m.title) }));
  },
});

const SETTINGS_READ_KEYS = ['title', 'description', 'url', 'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_page', 'timezone', 'date_format', 'default_category'];
const SETTINGS_WRITE_KEYS = ['title', 'description', 'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_page', 'default_category'];

defineTool({
  name: 'wp_get_site_settings',
  kind: 'read',
  description: 'Read core site settings: site title, tagline, which page is the homepage and the blog page, posts per page, timezone.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'Read site settings',
  run: async () => {
    const { json } = await wpRequest('GET', '/wp/v2/settings');
    return Object.fromEntries(SETTINGS_READ_KEYS.map((k) => [k, json[k]]));
  },
});

defineTool({
  name: 'wp_list_terms',
  kind: 'read',
  description: 'List blog categories or tags (id, name, slug, post count).',
  input_schema: {
    type: 'object',
    properties: { taxonomy: { type: 'string', enum: ['category', 'tag'] }, search: { type: 'string' } },
    required: ['taxonomy'],
    additionalProperties: false,
  },
  summarize: (i) => `List ${i.taxonomy === 'tag' ? 'tags' : 'categories'}`,
  run: async ({ taxonomy, search }) => {
    const r = taxonomy === 'tag' ? '/wp/v2/tags' : '/wp/v2/categories';
    return (await wpRequest('GET', r, { query: { search, per_page: 100, _fields: 'id,name,slug,count,parent' } })).json;
  },
});

defineTool({
  name: 'wp_list_plugins',
  kind: 'read',
  description: 'List installed WordPress plugins with active/inactive status and version.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  summarize: () => 'List plugins',
  run: async () =>
    (await wpRequest('GET', '/wp/v2/plugins', { query: { _fields: 'plugin,name,status,version' } })).json.map((p) => ({
      ...p,
      name: decode(p.name),
    })),
});

defineTool({
  name: 'wp_list_revisions',
  kind: 'read',
  description: 'List saved WordPress revisions of a post or page (id, date) so an older version can be restored.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['post', 'page'] } },
    required: ['id', 'type'],
    additionalProperties: false,
  },
  summarize: (i) => `List revisions of ${i.type} #${i.id}`,
  run: async ({ id, type }) =>
    (await wpRequest('GET', `${route(type)}/${id}/revisions`, { query: { per_page: 15, _fields: 'id,date,author,title' } })).json.map((r) => ({
      id: r.id,
      date: r.date,
      title: decode(r.title?.rendered),
    })),
});

// ---------------------------------------------------------------------------------------------
// Website (WordPress) - write (every one of these waits for human approval)
// ---------------------------------------------------------------------------------------------

async function restoreFieldsChange(type, id, before, afterContent, summary) {
  return {
    summary,
    targetType: type,
    targetId: String(id),
    undo: { kind: 'restore_fields', type, id, fields: before, expectHash: afterContent !== undefined ? hash(afterContent) : undefined },
  };
}

defineTool({
  name: 'wp_create_post',
  kind: 'write',
  risk: 'medium',
  description:
    'Create a new blog post. Defaults to status "draft" (not visible to the public) unless the user explicitly asked to publish. content_html is Classic Editor HTML (h2/h3/p/ul/li/strong/a/img).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content_html: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'] },
      excerpt: { type: 'string' },
      slug: { type: 'string' },
      categories: { type: 'array', items: { type: 'integer' } },
      tags: { type: 'array', items: { type: 'integer' } },
      featured_media_id: { type: 'integer' },
    },
    required: ['title', 'content_html'],
    additionalProperties: false,
  },
  postWrite: true,
  riskFor: (i) => (i.status === 'publish' ? 'high' : 'medium'),
  summarize: (i) => `Create blog post "${i.title}" as ${i.status || 'draft'}`,
  preview: async (i) => ({
    title: i.title,
    status: i.status || 'draft',
    slug: i.slug || '(auto)',
    words: plainText(i.content_html).split(' ').filter(Boolean).length,
    problem: placeholderProblem(null, newPostBody(i)),
  }),
  run: async (i) => {
    const { json } = await createPost('post', newPostBody(i));
    return {
      result: { id: json.id, status: json.status, link: json.link },
      change: { summary: `Created post "${i.title}" (#${json.id}, ${json.status})`, targetType: 'post', targetId: String(json.id), undo: { kind: 'trash', type: 'post', id: json.id } },
    };
  },
});

function newPostBody(i) {
  return {
    title: i.title,
    content: i.content_html,
    status: i.status || 'draft',
    ...(i.excerpt ? { excerpt: i.excerpt } : {}),
    ...(i.slug ? { slug: i.slug } : {}),
    ...(i.categories ? { categories: i.categories } : {}),
    ...(i.tags ? { tags: i.tags } : {}),
    ...(i.featured_media_id ? { featured_media: i.featured_media_id } : {}),
  };
}

function newPageBody(i) {
  return { title: i.title, content: i.content, status: i.status || 'draft', ...(i.slug ? { slug: i.slug } : {}), ...(i.parent ? { parent: i.parent } : {}) };
}

defineTool({
  name: 'wp_create_page',
  kind: 'write',
  risk: 'medium',
  description: 'Create a new page. Defaults to "draft". content may be HTML or WPBakery shortcodes.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'] },
      slug: { type: 'string' },
      parent: { type: 'integer' },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  postWrite: true,
  riskFor: (i) => (i.status === 'publish' ? 'high' : 'medium'),
  summarize: (i) => `Create page "${i.title}" as ${i.status || 'draft'}`,
  preview: async (i) => ({ title: i.title, status: i.status || 'draft', slug: i.slug || '(auto)', problem: placeholderProblem(null, newPageBody(i)) }),
  run: async (i) => {
    const { json } = await createPost('page', newPageBody(i));
    return {
      result: { id: json.id, status: json.status, link: json.link },
      change: { summary: `Created page "${i.title}" (#${json.id}, ${json.status})`, targetType: 'page', targetId: String(json.id), undo: { kind: 'trash', type: 'page', id: json.id } },
    };
  },
});

defineTool({
  name: 'wp_update_fields',
  kind: 'write',
  risk: 'medium',
  description:
    'Change fields of an existing post or page: title, slug, status, excerpt, categories, tags, featured image, or the FULL content. Only use content_html to replace the whole body of a normal blog post; for WPBakery pages or small edits use wp_replace_text / wp_insert_content instead so the page layout is not damaged.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      type: { type: 'string', enum: ['post', 'page'] },
      title: { type: 'string' },
      slug: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'] },
      excerpt: { type: 'string' },
      content_html: { type: 'string' },
      categories: { type: 'array', items: { type: 'integer' } },
      tags: { type: 'array', items: { type: 'integer' } },
      featured_media_id: { type: 'integer' },
    },
    required: ['id', 'type'],
    additionalProperties: false,
  },
  postWrite: true,
  riskFor: (i) => (i.status || i.slug || (i.content_html && i.type === 'page') ? 'high' : 'medium'),
  summarize: (i) => {
    const fields = Object.keys(i).filter((k) => !['id', 'type'].includes(k));
    return `Update ${i.type} #${i.id}: ${fields.join(', ') || 'nothing'}`;
  },
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    const after = fieldsFromInput(i);
    const warnings: string[] = [];
    if (i.content_html && isWpbakery(current.content)) warnings.push('This page is built with WPBakery; replacing the whole content can break its layout.');
    if (i.slug && i.slug !== current.slug) warnings.push('Changing the slug changes the URL. Add a redirect from the old URL (Redirect Redirection plugin) so links and rankings are not lost.');
    return { target: `${decode(current.title)} (${current.link})`, problem: placeholderProblem(current, after), changes: fieldDiffPreview(current, after), warnings };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    const after = fieldsFromInput(i);
    const before = Object.fromEntries(Object.keys(after).map((k) => [k, current[k]]));
    const { json } = await savePost(i.type, i.id, current, after);
    const change = await restoreFieldsChange(i.type, i.id, before, after.content, `Updated ${i.type} "${decode(current.title)}": ${Object.keys(after).join(', ')}`);
    return { result: { id: json.id, status: json.status, link: json.link }, change };
  },
});

function fieldsFromInput(i) {
  const out: any = {};
  if (i.title !== undefined) out.title = i.title;
  if (i.slug !== undefined) out.slug = i.slug;
  if (i.status !== undefined) out.status = i.status;
  if (i.excerpt !== undefined) out.excerpt = i.excerpt;
  if (i.content_html !== undefined) out.content = i.content_html;
  if (i.categories !== undefined) out.categories = i.categories;
  if (i.tags !== undefined) out.tags = i.tags;
  if (i.featured_media_id !== undefined) out.featured_media = i.featured_media_id;
  return out;
}

function replaceInContent(content, i) {
  return i.replace_all ? content.split(i.find).join(i.replace) : content.replace(i.find, () => i.replace);
}

defineTool({
  name: 'wp_replace_text',
  kind: 'write',
  risk: 'medium',
  description:
    'Precise find-and-replace inside the raw content of a post or page (safe for WPBakery pages). "find" must be copied exactly from wp_get_content and must match exactly once unless replace_all is true. Use this for changing a phone number, fixing wording, updating a figure, changing a link, etc.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      type: { type: 'string', enum: ['post', 'page'] },
      find: { type: 'string' },
      replace: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['id', 'type', 'find', 'replace'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Edit text on ${i.type} #${i.id}: "${snippet(i.find, 60)}" → "${snippet(i.replace, 60)}"`,
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    const n = countOccurrences(current.content, i.find);
    const idx = current.content.indexOf(i.find);
    return {
      target: `${decode(current.title)} (${current.link})`,
      occurrences: n,
      willReplace: n === 0 ? 0 : i.replace_all ? n : 1,
      problem:
        n === 0
          ? 'The text was not found, this change would fail.'
          : n > 1 && !i.replace_all
            ? `The text appears ${n} times; this change would fail unless replace_all is set.`
            : placeholderProblem(current, { content: replaceInContent(current.content, i) }),
      context: idx >= 0 ? contextAround(current.content, idx) : null,
    };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    const n = countOccurrences(current.content, i.find);
    if (n === 0) throw new Error('The text to replace was not found (the page may have changed). Re-read it with wp_get_content.');
    if (n > 1 && !i.replace_all) throw new Error(`The text appears ${n} times; use a longer unique snippet or set replace_all.`);
    const content = replaceInContent(current.content, i);
    const { json } = await savePost(i.type, i.id, current, { content });
    const change = await restoreFieldsChange(i.type, i.id, { content: current.content }, content, `Edited text on ${i.type} "${decode(current.title)}" (${i.replace_all ? n : 1} replacement${n > 1 && i.replace_all ? 's' : ''})`);
    return { result: { id: json.id, link: json.link, replacements: i.replace_all ? n : 1 }, change };
  },
});

defineTool({
  name: 'wp_insert_content',
  kind: 'write',
  risk: 'medium',
  description:
    'Insert new content (HTML or WPBakery shortcodes) into a post or page without touching the rest. position: top | bottom | before_row | after_row (WPBakery pages, use row_index from the outline) | before_text | after_text (exact unique anchor_text copied from wp_get_content). For a WPBakery page, wrap new sections in [vc_row][vc_column]...[/vc_column][/vc_row] (text inside [vc_column_text]...[/vc_column_text]).',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      type: { type: 'string', enum: ['post', 'page'] },
      content: { type: 'string' },
      position: { type: 'string', enum: ['top', 'bottom', 'before_row', 'after_row', 'before_text', 'after_text'] },
      row_index: { type: 'integer', minimum: 0 },
      anchor_text: { type: 'string' },
    },
    required: ['id', 'type', 'content', 'position'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Insert content into ${i.type} #${i.id} (${i.position}${i.row_index !== undefined ? ` row ${i.row_index}` : ''})`,
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    let idx;
    let problem: string | null = null;
    try {
      idx = insertionIndex(current.content, i);
      problem = placeholderProblem(current, { content: current.content.slice(0, idx) + i.content + current.content.slice(idx) });
    } catch (e: any) {
      problem = e.message;
    }
    return {
      target: `${decode(current.title)} (${current.link})`,
      problem,
      insertedPreview: snippet(i.content, 300),
      context: idx !== undefined ? contextAround(current.content, idx) : null,
    };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    const idx = insertionIndex(current.content, i);
    const content = current.content.slice(0, idx) + i.content + current.content.slice(idx);
    const { json } = await savePost(i.type, i.id, current, { content });
    const change = await restoreFieldsChange(i.type, i.id, { content: current.content }, content, `Inserted content into ${i.type} "${decode(current.title)}" (${i.position})`);
    return { result: { id: json.id, link: json.link }, change };
  },
});

defineTool({
  name: 'wp_upload_image',
  kind: 'write',
  risk: 'low',
  description:
    'Upload an image the user attached in this chat (by its image_id) to the WordPress Media Library, with descriptive alt text (always write meaningful alt text). Returns the new media id and URL, which you can then insert with wp_insert_image or set as a featured image.',
  input_schema: {
    type: 'object',
    properties: {
      image_id: { type: 'integer' },
      alt_text: { type: 'string' },
      title: { type: 'string' },
      caption: { type: 'string' },
    },
    required: ['image_id', 'alt_text'],
    additionalProperties: false,
  },
  summarize: (i) => `Upload attached image #${i.image_id} to Media Library (alt: "${snippet(i.alt_text, 60)}")`,
  preview: async (i) => {
    const img = await prisma.image_library.findUnique({ where: { id: i.image_id }, select: { id: true, filename: true, width: true, height: true } });
    return img ? { file: img.filename, dimensions: img.width ? `${img.width}x${img.height}` : 'unknown', alt_text: i.alt_text } : { problem: `Attached image ${i.image_id} not found.` };
  },
  run: async (i) => {
    const img = await prisma.image_library.findUnique({ where: { id: i.image_id } });
    if (!img) throw new Error(`Attached image ${i.image_id} not found`);
    // PORT NOTE: img.path is now a storage key (lib/storage); lib/wordpress reads it via readFile.
    const media = await uploadMedia(img.path, { altText: i.alt_text, title: i.title, caption: i.caption });
    return {
      result: media,
      change: { summary: `Uploaded image "${img.filename}" to Media Library (#${media.id})`, targetType: 'media', targetId: String(media.id), undo: { kind: 'delete_media', id: media.id } },
    };
  },
});

defineTool({
  name: 'wp_insert_image',
  kind: 'write',
  risk: 'medium',
  description:
    'Insert an image that is already in the Media Library into a post or page at a chosen position (same positions as wp_insert_content). On WPBakery pages it becomes a WPBakery image row (as_banner=true makes it a full-width stretched banner row); on blog posts it becomes a Classic Editor image, optionally captioned and linked.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      type: { type: 'string', enum: ['post', 'page'] },
      media_id: { type: 'integer' },
      position: { type: 'string', enum: ['top', 'bottom', 'before_row', 'after_row', 'before_text', 'after_text'] },
      row_index: { type: 'integer', minimum: 0 },
      anchor_text: { type: 'string' },
      as_banner: { type: 'boolean' },
      align: { type: 'string', enum: ['center', 'left', 'right', 'none'] },
      link_url: { type: 'string' },
      caption: { type: 'string' },
    },
    required: ['id', 'type', 'media_id', 'position'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Insert image #${i.media_id}${i.as_banner ? ' as a full-width banner' : ''} into ${i.type} #${i.id} (${i.position}${i.row_index !== undefined ? ` row ${i.row_index}` : ''})`,
  preview: async (i) => {
    const [current, media] = await Promise.all([getRaw(i.type, i.id), wpRequest('GET', `/wp/v2/media/${i.media_id}`).then((r) => r.json)]);
    let idx;
    let problem: string | null = null;
    try {
      idx = insertionIndex(current.content, i);
      problem = placeholderProblem(current, { content: current.content.slice(0, idx) + imageMarkup(current, media, i) + current.content.slice(idx) });
    } catch (e: any) {
      problem = e.message;
    }
    return {
      target: `${decode(current.title)} (${current.link})`,
      image: media.source_url,
      problem,
      warning: !media.alt_text ? 'This image has no alt text; add it with wp_update_media for SEO and accessibility.' : null,
      context: idx !== undefined ? contextAround(current.content, idx) : null,
    };
  },
  run: async (i) => {
    const [current, media] = await Promise.all([getRaw(i.type, i.id), wpRequest('GET', `/wp/v2/media/${i.media_id}`).then((r) => r.json)]);
    const markup = imageMarkup(current, media, i);
    const idx = insertionIndex(current.content, i);
    const content = current.content.slice(0, idx) + markup + current.content.slice(idx);
    const { json } = await savePost(i.type, i.id, current, { content });
    const change = await restoreFieldsChange(i.type, i.id, { content: current.content }, content, `Inserted image #${media.id}${i.as_banner ? ' (banner)' : ''} into ${i.type} "${decode(current.title)}"`);
    return { result: { id: json.id, link: json.link, markup }, change };
  },
});

function imageMarkup(current, media, i) {
  const align = i.align || 'center';
  if (isWpbakery(current.content)) {
    const link = i.link_url ? ` onclick="custom_link" link="${escapeAttr(i.link_url)}"` : '';
    const rowAttrs = i.as_banner ? ' full_width="stretch_row_content_no_spaces"' : '';
    return `[vc_row${rowAttrs}][vc_column][vc_single_image image="${media.id}" img_size="full" alignment="${align === 'none' ? 'left' : align}"${link}${i.caption ? ` title="${escapeAttr(i.caption)}"` : ''}][/vc_column][/vc_row]`;
  }
  const w = media.media_details?.width;
  const h = media.media_details?.height;
  let img = `<img class="align${align} size-full wp-image-${media.id}" src="${escapeAttr(media.source_url)}" alt="${escapeAttr(media.alt_text)}"${w ? ` width="${w}" height="${h}"` : ''} />`;
  if (i.link_url) img = `<a href="${escapeAttr(i.link_url)}">${img}</a>`;
  const markup = i.caption ? `[caption id="attachment_${media.id}" align="align${align}"${w ? ` width="${w}"` : ''}]${img} ${escapeAttr(i.caption)}[/caption]` : img;
  return `\n${markup}\n`;
}

defineTool({
  name: 'wp_set_featured_image',
  kind: 'write',
  risk: 'low',
  description: 'Set the featured image (thumbnail shown on blog listings and social shares) of a post or page.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['post', 'page'] }, media_id: { type: 'integer' } },
    required: ['id', 'type', 'media_id'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Set featured image of ${i.type} #${i.id} to media #${i.media_id}`,
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    const { json } = await savePost(i.type, i.id, current, { featured_media: i.media_id });
    return {
      result: { id: json.id, featured_media: json.featured_media },
      change: await restoreFieldsChange(i.type, i.id, { featured_media: current.featured_media || 0 }, undefined, `Set featured image of "${decode(current.title)}" to #${i.media_id}`),
    };
  },
});

defineTool({
  name: 'wp_update_media',
  kind: 'write',
  risk: 'low',
  description: 'Update an existing Media Library image: alt text, title, caption.',
  input_schema: {
    type: 'object',
    properties: { media_id: { type: 'integer' }, alt_text: { type: 'string' }, title: { type: 'string' }, caption: { type: 'string' } },
    required: ['media_id'],
    additionalProperties: false,
  },
  summarize: (i) => `Update media #${i.media_id}${i.alt_text ? ` alt text: "${snippet(i.alt_text, 60)}"` : ''}`,
  run: async (i) => {
    const { json: before } = await wpRequest('GET', `/wp/v2/media/${i.media_id}`, { query: { context: 'edit' } });
    const body: any = {};
    const prev: any = {};
    if (i.alt_text !== undefined) { body.alt_text = i.alt_text; prev.alt_text = before.alt_text; }
    if (i.title !== undefined) { body.title = i.title; prev.title = before.title?.raw; }
    if (i.caption !== undefined) { body.caption = i.caption; prev.caption = before.caption?.raw; }
    const { json } = await wpRequest('POST', `/wp/v2/media/${i.media_id}`, { body });
    return {
      result: { id: json.id, alt_text: json.alt_text },
      change: { summary: `Updated media #${i.media_id}: ${Object.keys(body).join(', ')}`, targetType: 'media', targetId: String(i.media_id), undo: { kind: 'restore_media_fields', id: i.media_id, fields: prev } },
    };
  },
});

defineTool({
  name: 'wp_update_yoast_seo',
  kind: 'write',
  risk: 'low',
  description:
    'Set the Yoast SEO meta description, focus keyphrase and/or SEO title of a post or page. Requires a one-time snippet on the WordPress site; if it is missing this fails with instructions.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      type: { type: 'string', enum: ['post', 'page'] },
      meta_description: { type: 'string' },
      focus_keyphrase: { type: 'string' },
      seo_title: { type: 'string' },
    },
    required: ['id', 'type'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Update Yoast SEO fields on ${i.type} #${i.id}`,
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    const exposed = '_yoast_wpseo_metadesc' in current.meta;
    return {
      target: `${decode(current.title)} (${current.link})`,
      meta_description: i.meta_description ? `${i.meta_description.length} characters` : undefined,
      problem: exposed
        ? placeholderProblem(current, { meta: yoastMetaFromInput(i) })
        : 'The Yoast REST snippet is not installed on the site yet, so this will fail. See Settings > Yoast SEO fields in the dashboard.',
    };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    if (!('_yoast_wpseo_metadesc' in current.meta)) {
      throw new Error('Yoast SEO fields are not writable via the WordPress API yet. Install the one-time snippet shown in the dashboard Settings tab (Yoast SEO fields card), then try again.');
    }
    const meta = yoastMetaFromInput(i);
    const before = Object.fromEntries(Object.keys(meta).map((k) => [k, current.meta[k] || '']));
    await savePost(i.type, i.id, current, { meta });
    await refreshYoast(i.type, i.id);
    return {
      result: { id: i.id, updated: Object.keys(meta) },
      change: await restoreFieldsChange(i.type, i.id, { meta: before }, undefined, `Updated Yoast SEO fields on "${decode(current.title)}"`),
    };
  },
});

function yoastMetaFromInput(i) {
  const meta: any = {};
  if (i.meta_description !== undefined) meta._yoast_wpseo_metadesc = i.meta_description;
  if (i.focus_keyphrase !== undefined) meta._yoast_wpseo_focuskw = i.focus_keyphrase;
  if (i.seo_title !== undefined) meta._yoast_wpseo_title = i.seo_title;
  return meta;
}

defineTool({
  name: 'wp_update_settings',
  kind: 'write',
  risk: 'high',
  description:
    'Change core site settings: site title, tagline (description), homepage display (show_on_front, page_on_front, page_for_posts), posts_per_page, default_category. Changing the homepage affects the whole site.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      show_on_front: { type: 'string', enum: ['posts', 'page'] },
      page_on_front: { type: 'integer' },
      page_for_posts: { type: 'integer' },
      posts_per_page: { type: 'integer', minimum: 1, maximum: 100 },
      default_category: { type: 'integer' },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Change site settings: ${Object.keys(i).join(', ')}`,
  preview: async (i) => {
    const { json } = await wpRequest('GET', '/wp/v2/settings');
    return { changes: Object.keys(i).map((k) => ({ field: k, before: JSON.stringify(json[k]), after: JSON.stringify(i[k]) })) };
  },
  run: async (i) => {
    const body = Object.fromEntries(Object.entries(i).filter(([k]) => SETTINGS_WRITE_KEYS.includes(k)));
    if (!Object.keys(body).length) throw new Error('No allowed settings to change');
    const { json: before } = await wpRequest('GET', '/wp/v2/settings');
    await wpRequest('POST', '/wp/v2/settings', { body });
    return {
      result: { updated: Object.keys(body) },
      change: {
        summary: `Changed site settings: ${Object.keys(body).join(', ')}`,
        targetType: 'settings',
        targetId: 'site',
        undo: { kind: 'restore_settings', fields: Object.fromEntries(Object.keys(body).map((k) => [k, before[k]])) },
      },
    };
  },
});

defineTool({
  name: 'wp_add_menu_item',
  kind: 'write',
  risk: 'medium',
  description: 'Add an item to a navigation menu: link to a page (page_id), post (post_id), category (category_id) or a custom URL (url). Optional parent_item_id makes it a dropdown child.',
  input_schema: {
    type: 'object',
    properties: {
      menu_id: { type: 'integer' },
      title: { type: 'string' },
      url: { type: 'string' },
      page_id: { type: 'integer' },
      post_id: { type: 'integer' },
      category_id: { type: 'integer' },
      parent_item_id: { type: 'integer' },
      menu_order: { type: 'integer' },
    },
    required: ['menu_id', 'title'],
    additionalProperties: false,
  },
  summarize: (i) => `Add "${i.title}" to menu #${i.menu_id}`,
  run: async (i) => {
    const body: any = { title: i.title, menus: i.menu_id, status: 'publish' };
    if (i.page_id) Object.assign(body, { type: 'post_type', object: 'page', object_id: i.page_id });
    else if (i.post_id) Object.assign(body, { type: 'post_type', object: 'post', object_id: i.post_id });
    else if (i.category_id) Object.assign(body, { type: 'taxonomy', object: 'category', object_id: i.category_id });
    else if (i.url) Object.assign(body, { type: 'custom', url: i.url });
    else throw new Error('Give one of page_id, post_id, category_id or url');
    if (i.parent_item_id) body.parent = i.parent_item_id;
    if (i.menu_order !== undefined) body.menu_order = i.menu_order;
    const { json } = await wpRequest('POST', '/wp/v2/menu-items', { body });
    return {
      result: { id: json.id, url: json.url },
      change: { summary: `Added menu item "${i.title}" (#${json.id}) to menu #${i.menu_id}`, targetType: 'menu_item', targetId: String(json.id), undo: { kind: 'delete_menu_item', id: json.id } },
    };
  },
});

defineTool({
  name: 'wp_update_menu_item',
  kind: 'write',
  risk: 'medium',
  description: 'Rename, re-link, re-order or re-parent an existing menu item.',
  input_schema: {
    type: 'object',
    properties: {
      item_id: { type: 'integer' },
      title: { type: 'string' },
      url: { type: 'string' },
      menu_order: { type: 'integer' },
      parent_item_id: { type: 'integer' },
    },
    required: ['item_id'],
    additionalProperties: false,
  },
  summarize: (i) => `Update menu item #${i.item_id}`,
  run: async (i) => {
    const { json: before } = await wpRequest('GET', `/wp/v2/menu-items/${i.item_id}`, { query: { context: 'edit' } });
    const body: any = {};
    const prev: any = {};
    if (i.title !== undefined) { body.title = i.title; prev.title = before.title?.raw ?? before.title; }
    if (i.url !== undefined) { body.url = i.url; prev.url = before.url; }
    if (i.menu_order !== undefined) { body.menu_order = i.menu_order; prev.menu_order = before.menu_order; }
    if (i.parent_item_id !== undefined) { body.parent = i.parent_item_id; prev.parent = before.parent; }
    const { json } = await wpRequest('POST', `/wp/v2/menu-items/${i.item_id}`, { body });
    return {
      result: { id: json.id },
      change: { summary: `Updated menu item #${i.item_id}: ${Object.keys(body).join(', ')}`, targetType: 'menu_item', targetId: String(i.item_id), undo: { kind: 'restore_menu_item', id: i.item_id, fields: prev } },
    };
  },
});

defineTool({
  name: 'wp_remove_menu_item',
  kind: 'write',
  risk: 'medium',
  description: 'Remove an item from a navigation menu (the linked page itself is not affected).',
  input_schema: { type: 'object', properties: { item_id: { type: 'integer' } }, required: ['item_id'], additionalProperties: false },
  summarize: (i) => `Remove menu item #${i.item_id}`,
  run: async (i) => {
    const { json: before } = await wpRequest('GET', `/wp/v2/menu-items/${i.item_id}`, { query: { context: 'edit' } });
    await wpRequest('DELETE', `/wp/v2/menu-items/${i.item_id}`, { query: { force: 'true' } });
    const fields = {
      title: before.title?.raw ?? before.title,
      menus: before.menus,
      status: 'publish',
      type: before.type,
      object: before.object,
      object_id: before.object_id,
      url: before.url,
      parent: before.parent,
      menu_order: before.menu_order,
    };
    return {
      result: { removed: i.item_id },
      change: { summary: `Removed menu item "${fields.title}" (#${i.item_id})`, targetType: 'menu_item', targetId: String(i.item_id), undo: { kind: 'recreate_menu_item', fields } },
    };
  },
});

defineTool({
  name: 'wp_create_term',
  kind: 'write',
  risk: 'low',
  description: 'Create a new blog category or tag.',
  input_schema: {
    type: 'object',
    properties: {
      taxonomy: { type: 'string', enum: ['category', 'tag'] },
      name: { type: 'string' },
      slug: { type: 'string' },
      parent: { type: 'integer' },
      description: { type: 'string' },
    },
    required: ['taxonomy', 'name'],
    additionalProperties: false,
  },
  summarize: (i) => `Create ${i.taxonomy} "${i.name}"`,
  run: async (i) => {
    const r = i.taxonomy === 'tag' ? '/wp/v2/tags' : '/wp/v2/categories';
    const { json } = await wpRequest('POST', r, {
      body: { name: i.name, ...(i.slug ? { slug: i.slug } : {}), ...(i.parent ? { parent: i.parent } : {}), ...(i.description ? { description: i.description } : {}) },
    });
    return {
      result: { id: json.id, name: json.name },
      change: { summary: `Created ${i.taxonomy} "${i.name}" (#${json.id})`, targetType: i.taxonomy, targetId: String(json.id), undo: { kind: 'delete_term', taxonomy: i.taxonomy, id: json.id } },
    };
  },
});

defineTool({
  name: 'wp_trash_content',
  kind: 'write',
  risk: 'high',
  description: 'Move a post or page to the WordPress trash (it disappears from the site but can be restored). Never deletes permanently.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['post', 'page'] } },
    required: ['id', 'type'],
    additionalProperties: false,
  },
  summarize: (i) => `Move ${i.type} #${i.id} to trash`,
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    return { target: `${decode(current.title)} (${current.link})`, status: current.status, warning: 'Anyone visiting this URL will get a "not found" page. Consider a redirect.' };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    await wpRequest('DELETE', `${route(i.type)}/${i.id}`);
    return {
      result: { trashed: i.id },
      change: { summary: `Moved ${i.type} "${decode(current.title)}" to trash`, targetType: i.type, targetId: String(i.id), undo: { kind: 'untrash', type: i.type, id: i.id, status: current.status } },
    };
  },
});

defineTool({
  name: 'wp_restore_revision',
  kind: 'write',
  risk: 'medium',
  description: 'Restore a post or page to one of its saved WordPress revisions (from wp_list_revisions).',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['post', 'page'] }, revision_id: { type: 'integer' } },
    required: ['id', 'type', 'revision_id'],
    additionalProperties: false,
  },
  postWrite: true,
  summarize: (i) => `Restore ${i.type} #${i.id} to revision #${i.revision_id}`,
  preview: async (i) => {
    const current = await getRaw(i.type, i.id);
    const rev = await getRevision(i);
    const body = revisionBody(current, rev);
    return {
      target: `${decode(current.title)} (${current.link})`,
      status: current.status,
      revision_date: rev.date,
      problem: placeholderProblem(current, body),
      changes: fieldDiffPreview(current, body),
    };
  },
  run: async (i) => {
    const current = await getRaw(i.type, i.id);
    const body = revisionBody(current, await getRevision(i));
    await savePost(i.type, i.id, current, body);
    return {
      result: { restored: i.revision_id },
      change: await restoreFieldsChange(i.type, i.id, { content: current.content, title: current.title }, body.content, `Restored ${i.type} "${decode(current.title)}" to revision #${i.revision_id}`),
    };
  },
});

async function getRevision(i) {
  return (await wpRequest('GET', `${route(i.type)}/${i.id}/revisions/${i.revision_id}`, { query: { context: 'edit' } })).json;
}

function revisionBody(current, rev) {
  return { content: rev.content?.raw ?? '', title: rev.title?.raw ?? current.title };
}

defineTool({
  name: 'wp_set_plugin_status',
  kind: 'write',
  risk: 'high',
  description:
    'Activate or deactivate an installed plugin (use the "plugin" value from wp_list_plugins, e.g. "akismet/akismet"). Deactivating security, cache, SEO, form or page-builder plugins can break the site; warn the user first.',
  input_schema: {
    type: 'object',
    properties: { plugin: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] } },
    required: ['plugin', 'status'],
    additionalProperties: false,
  },
  summarize: (i) => `${i.status === 'active' ? 'Activate' : 'Deactivate'} plugin ${i.plugin}`,
  run: async (i) => {
    const { json: before } = await wpRequest('GET', `/wp/v2/plugins/${i.plugin}`);
    const { json } = await wpRequest('POST', `/wp/v2/plugins/${i.plugin}`, { body: { status: i.status } });
    return {
      result: { plugin: json.plugin, status: json.status },
      change: { summary: `Set plugin ${decode(before.name)} to ${i.status}`, targetType: 'plugin', targetId: i.plugin, undo: { kind: 'plugin_status', plugin: i.plugin, status: before.status } },
    };
  },
});

defineTool({
  name: 'wp_install_plugin',
  kind: 'write',
  risk: 'high',
  description:
    'Install a plugin from the official WordPress.org directory by its slug (e.g. "code-snippets"). It is installed INACTIVE; activate it separately with wp_set_plugin_status. Before proposing, check (web search) that it is well maintained and widely used.',
  input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
  summarize: (i) => `Install plugin "${i.slug}" from WordPress.org (inactive)`,
  run: async (i) => {
    const { json } = await wpRequest('POST', '/wp/v2/plugins', { body: { slug: i.slug, status: 'inactive' } });
    return {
      result: { plugin: json.plugin, name: decode(json.name), status: json.status, version: json.version },
      change: { summary: `Installed plugin ${decode(json.name)} (inactive)`, targetType: 'plugin', targetId: json.plugin, undo: { kind: 'delete_plugin', plugin: json.plugin } },
    };
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
    'Run the full SEO/AEO/GEO + fact-check audit on a blog (pasted HTML/text, a public URL, or an existing post id). Works for any blog, including someone else\'s. Takes 1-2 minutes and uses AI credits. The result appears in the Blog Audit tab, where the user can generate the rewrite, see what changed and why, and download it as Word.',
  input_schema: {
    type: 'object',
    properties: {
      content_html: { type: 'string' },
      source_url: { type: 'string' },
      wp_post_id: { type: 'integer' },
      title: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  summarize: (i) => `Run a blog audit on ${i.wp_post_id ? `post #${i.wp_post_id}` : i.source_url ? i.source_url : 'the pasted blog'}`,
  run: async (i, ctx) => {
    ctx.emit?.({ type: 'tool_progress', text: 'Auditing the blog (researching every claim, 1-2 minutes)…' });
    const audit = await createAudit({ title: i.title, contentHtml: i.content_html, sourceUrl: i.source_url, wpPostId: i.wp_post_id });
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

// ---------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------

async function undoChange(undo, { force = false }: { force?: boolean } = {}) {
  switch (undo.kind) {
    case 'restore_fields': {
      if (undo.expectHash && !force) {
        const current = await getRaw(undo.type, undo.id);
        if (hash(current.content) !== undo.expectHash) {
          const err: any = new Error('This content was edited again after this change. Undoing now would also remove those later edits.');
          err.code = 'CHANGED_SINCE';
          throw err;
        }
      }
      await wpRequest('POST', `${route(undo.type)}/${undo.id}`, { body: undo.fields });
      return 'Restored the previous version.';
    }
    case 'trash':
      await wpRequest('DELETE', `${route(undo.type)}/${undo.id}`);
      return 'Moved the created item to trash.';
    case 'untrash':
      await wpRequest('POST', `${route(undo.type)}/${undo.id}`, { body: { status: undo.status || 'draft' } });
      return 'Restored from trash.';
    case 'delete_media':
      await wpRequest('DELETE', `/wp/v2/media/${undo.id}`, { query: { force: 'true' } });
      return 'Deleted the uploaded image from the Media Library.';
    case 'restore_media_fields':
      await wpRequest('POST', `/wp/v2/media/${undo.id}`, { body: undo.fields });
      return 'Restored the image details.';
    case 'restore_settings':
      await wpRequest('POST', '/wp/v2/settings', { body: undo.fields });
      return 'Restored the previous settings.';
    case 'delete_menu_item':
      await wpRequest('DELETE', `/wp/v2/menu-items/${undo.id}`, { query: { force: 'true' } });
      return 'Removed the menu item.';
    case 'restore_menu_item':
      await wpRequest('POST', `/wp/v2/menu-items/${undo.id}`, { body: undo.fields });
      return 'Restored the menu item.';
    case 'recreate_menu_item':
      await wpRequest('POST', '/wp/v2/menu-items', { body: undo.fields });
      return 'Re-added the menu item.';
    case 'delete_term':
      await wpRequest('DELETE', `${undo.taxonomy === 'tag' ? '/wp/v2/tags' : '/wp/v2/categories'}/${undo.id}`, { query: { force: 'true' } });
      return 'Deleted the created term.';
    case 'plugin_status':
      await wpRequest('POST', `/wp/v2/plugins/${undo.plugin}`, { body: { status: undo.status } });
      return `Plugin set back to ${undo.status}.`;
    case 'delete_plugin':
      await wpRequest('POST', `/wp/v2/plugins/${undo.plugin}`, { body: { status: 'inactive' } });
      await wpRequest('DELETE', `/wp/v2/plugins/${undo.plugin}`);
      return 'Uninstalled the plugin.';
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

function getTool(name) {
  return TOOLS.find((t) => t.name === name);
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

export { TOOLS, API_TOOLS, getTool, validate, riskOf, serializeResult, undoChange };

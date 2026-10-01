// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import prisma from './prisma';
import { sqlNowOffset } from './time';
import * as questionBankMod from './questionBank';
import { querySearchAnalytics, googleAuth } from './searchConsole';
import { eventsAffecting } from './seoCalendar';
import { wpRequest } from './wordpress';
import { listSites, getSiteRankings } from './seranking';
// Performance of the site in three lenses, computed in code from Search Console, GA4, WordPress,
// SE Ranking, the crawl and the latest strategy run. No AI calls, so it is free and always exact.
//   SEO: rankings and organic traffic (classic blue links).
//   AEO: answer engines: question searches, People Also Ask, FAQ coverage.
//   GEO: generative AI: visits from AI assistants, AI Overview citations, content freshness.


const DAY = 24 * 60 * 60 * 1000;
const BRAND = /usa? ?-?india ?-?cfo|usaindia/i;
const QUESTION = /^(how|what|why|when|where|which|who|can|could|does|do|did|is|are|was|were|will|should|would|need)\b|\?$/i;
const AI_SOURCE = 'chatgpt\\.com|chat\\.openai\\.com|openai|perplexity|gemini\\.google|copilot|edgeservices\\.bing\\.com|claude\\.ai';

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (dateStr, n) => iso(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY);
const round = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const pct = (now, before) => (before ? round(((now - before) / before) * 100) : null);

function windows(days) {
  const end = iso(Date.now() - 2 * DAY); // the latest ~48 hours of Search Console data are incomplete
  const curStart = addDays(end, -(days - 1));
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const weeks = Math.max(12, Math.ceil((days * 2) / 7));
  const seriesStart = addDays(end, -(weeks * 7 - 1));
  return { end, current: { startDate: curStart, endDate: end }, previous: { startDate: prevStart, endDate: prevEnd }, weeks, seriesStart };
}

// Weekly buckets ending on `end`, oldest first.
function weekBuckets(end, weeks) {
  const out: any[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const e = addDays(end, -i * 7);
    out.push({ start: addDays(e, -6), end: e });
  }
  return out;
}

const inRange = (date, r) => date >= r.startDate && date <= r.endDate;

function bucketSum(rows, buckets, pick) {
  return buckets.map((b) => rows.reduce((s, r) => (r.date >= b.start && r.date <= b.end ? s + pick(r) : s), 0));
}

function sumRange(rows, range, pick) {
  return rows.reduce((s, r) => (inRange(r.date, range) ? s + pick(r) : s), 0);
}

function kpi(label, now, before, opts = {}) {
  return { label, now: round(now, opts.digits ?? 0), before: round(before, opts.digits ?? 0), changePct: pct(now, before), unit: opts.unit || '', lowerIsBetter: Boolean(opts.lowerIsBetter), note: opts.note || '' };
}

// traffic light from a % change (or a points change for position)
function light(change, { good = 5, bad = -10, invert = false }: any = {}) {
  if (change === null || change === undefined) return 'unknown';
  const c = invert ? -change : change;
  return c >= good ? 'good' : c <= bad ? 'bad' : 'watch';
}

async function ga4Report(body) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID is not set');
  const client = await googleAuth(['https://www.googleapis.com/auth/analytics.readonly']).getClient();
  const token = (await client.getAccessToken()).token;
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`GA4: ${json.error?.message || res.status}`);
  return json.rows || [];
}
const gaDate = (v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

async function wordpressPosts() {
  const posts: any[] = [];
  for (let page = 1; page <= 6; page++) {
    const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { per_page: 100, page, status: 'publish', _fields: 'id,link,modified,content' } });
    posts.push(...json);
    if (json.length < 100) break;
  }
  return posts;
}

function contentStats(posts) {
  const now = Date.now();
  const withFaq = posts.filter((p) => /<h[2-4][^>]*>(?:\s|<[^>]+>)*(FAQ|Frequently Asked Questions)/i.test(p.content?.rendered || '')).length;
  const fresh90 = posts.filter((p) => now - Date.parse(p.modified) <= 90 * DAY).length;
  const fresh365 = posts.filter((p) => now - Date.parse(p.modified) <= 365 * DAY).length;
  const stale = posts.filter((p) => now - Date.parse(p.modified) > 730 * DAY).length;
  return { posts: posts.length, withFaq, faqPct: posts.length ? round((withFaq / posts.length) * 100) : null, fresh90, fresh90Pct: posts.length ? round((fresh90 / posts.length) * 100) : null, fresh365, stale2y: stale };
}

async function gatherPerformance(days = 28) {
  const w = windows(days);
  const buckets = weekBuckets(w.end, w.weeks);
  const labels = buckets.map((b) => b.start.slice(5));
  const errors: any = {};
  const safe = async (name, fn) => {
    try {
      return await fn();
    } catch (e: any) {
      errors[name] = e.message;
      return null;
    }
  };

  const range = { startDate: w.seriesStart, endDate: w.end };
  const [daily, qRows, pageCur, pagePrev, gaOrganic, gaAi, posts] = await Promise.all([
    safe('searchConsole', () => querySearchAnalytics({ ...range, dimensions: ['date'], rowLimit: 25000 })),
    safe('searchConsoleQueries', () => querySearchAnalytics({ ...range, dimensions: ['date', 'query'], rowLimit: 25000 })),
    safe('pages', () => querySearchAnalytics({ ...w.current, dimensions: ['page'], rowLimit: 500 })),
    safe('pagesBefore', () => querySearchAnalytics({ ...w.previous, dimensions: ['page'], rowLimit: 500 })),
    safe('ga4Organic', () =>
      ga4Report({
        dateRanges: [{ startDate: w.seriesStart, endDate: w.end }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } },
        limit: 1000,
      })
    ),
    safe('ga4Ai', () =>
      ga4Report({
        dateRanges: [{ startDate: w.seriesStart, endDate: w.end }],
        dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: AI_SOURCE, caseSensitive: false } } },
        limit: 5000,
      })
    ),
    safe('wordpress', wordpressPosts),
  ]);

  const dayRows = (daily || []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const qs = (qRows || []).map((r) => ({ date: r.keys[0], query: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const organic = (gaOrganic || []).map((r) => ({ date: gaDate(r.dimensionValues[0].value), sessions: Number(r.metricValues[0].value), conversions: Number(r.metricValues[1].value) }));
  const ai = (gaAi || []).map((r) => ({ date: gaDate(r.dimensionValues[0].value), source: r.dimensionValues[1].value, sessions: Number(r.metricValues[0].value), conversions: Number(r.metricValues[1].value) }));

  // ---------- SEO ----------
  const brandRows = qs.filter((r) => BRAND.test(r.query));
  const questionRows = qs.filter((r) => !BRAND.test(r.query) && QUESTION.test(r.query.trim()));
  const posW = (rows, range) => {
    const sel = rows.filter((r) => inRange(r.date, range));
    const impr = sel.reduce((s, r) => s + r.impressions, 0);
    return impr ? sel.reduce((s, r) => s + r.position * r.impressions, 0) / impr : null;
  };
  const clicksNow = sumRange(dayRows, w.current, (r) => r.clicks);
  const clicksBefore = sumRange(dayRows, w.previous, (r) => r.clicks);
  const imprNow = sumRange(dayRows, w.current, (r) => r.impressions);
  const imprBefore = sumRange(dayRows, w.previous, (r) => r.impressions);
  const brandNow = sumRange(brandRows, w.current, (r) => r.clicks);
  const brandBefore = sumRange(brandRows, w.previous, (r) => r.clicks);
  const posNow = posW(dayRows, w.current);
  const posBefore = posW(dayRows, w.previous);
  const orgSessNow = sumRange(organic, w.current, (r) => r.sessions);
  const orgSessBefore = sumRange(organic, w.previous, (r) => r.sessions);
  const orgConvNow = sumRange(organic, w.current, (r) => r.conversions);
  const orgConvBefore = sumRange(organic, w.previous, (r) => r.conversions);

  const byPage = new Map((pagePrev || []).map((r) => [r.keys[0], r.clicks]));
  const pageDiffs = (pageCur || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, before: byPage.get(r.keys[0]) || 0, change: r.clicks - (byPage.get(r.keys[0]) || 0) }));
  const topPages = [...pageDiffs].sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const losers = pageDiffs.filter((p) => p.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
  const gainers = pageDiffs.filter((p) => p.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);

  let tracked: any = null;
  await safe('seRanking', async () => {
    const sites = await listSites();
    if (!sites.length) return;
    const rows = await getSiteRankings(sites[0].id);
    const bucket = (p) => (!p ? 'notRanked' : p <= 3 ? 'top3' : p <= 10 ? 'top4to10' : p <= 20 ? 'top11to20' : 'top21to100');
    const distribution = { top3: 0, top4to10: 0, top11to20: 0, top21to100: 0, notRanked: 0 };
    for (const r of rows) distribution[bucket(r.position)]++;
    tracked = { total: rows.length, distribution, top10: distribution.top3 + distribution.top4to10 };
  });
  const crawl = await prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });

  const seoClicksChange = pct(clicksNow, clicksBefore);
  const seo = {
    status: light(seoClicksChange),
    kpis: [
      kpi('Google clicks', clicksNow, clicksBefore),
      kpi('Non-branded clicks', clicksNow - brandNow, clicksBefore - brandBefore, { note: 'All clicks minus searches for the brand name' }),
      kpi('Impressions', imprNow, imprBefore, { note: 'Comparable only when both periods start after 28 Apr 2026' }),
      kpi('Click-through rate', imprNow ? (clicksNow / imprNow) * 100 : 0, imprBefore ? (clicksBefore / imprBefore) * 100 : 0, { digits: 2, unit: '%' }),
      kpi('Average position', posNow ?? 0, posBefore ?? 0, { digits: 1, lowerIsBetter: true }),
      kpi('Organic visits (GA4)', orgSessNow, orgSessBefore),
      kpi('Organic conversions (GA4)', orgConvNow, orgConvBefore),
    ],
    series: {
      labels,
      clicks: bucketSum(dayRows, buckets, (r) => r.clicks),
      nonBrandedClicks: buckets.map((b, i) => bucketSum(dayRows, [b], (r) => r.clicks)[0] - bucketSum(brandRows, [b], (r) => r.clicks)[0]),
      impressions: bucketSum(dayRows, buckets, (r) => r.impressions),
      organicVisits: bucketSum(organic, buckets, (r) => r.sessions),
    },
    topPages,
    gainers,
    losers,
    tracked,
    technical: crawl
      ? { importedAt: crawl.created_at, urls: crawl.total_urls, broken: crawl.broken_count, missingTitles: crawl.missing_title_count, missingMeta: crawl.missing_meta_count, thin: crawl.thin_content_count }
      : null,
  };
  seo.headline = `Google clicks were ${clicksNow} in the last ${days} days, ${seoClicksChange === null ? 'with no earlier period to compare' : `${seoClicksChange >= 0 ? 'up' : 'down'} ${Math.abs(seoClicksChange)}% on the ${days} days before`}. ${tracked ? `${tracked.top10} of ${tracked.total} tracked keywords are in the top 10.` : ''}`.trim();

  // ---------- AEO ----------
  const qClicksNow = sumRange(questionRows, w.current, (r) => r.clicks);
  const qClicksBefore = sumRange(questionRows, w.previous, (r) => r.clicks);
  const qImprNow = sumRange(questionRows, w.current, (r) => r.impressions);
  const qImprBefore = sumRange(questionRows, w.previous, (r) => r.impressions);
  const qNow = new Map();
  for (const r of questionRows.filter((x) => inRange(x.date, w.current))) {
    const e = qNow.get(r.query) || { query: r.query, clicks: 0, impressions: 0, posSum: 0 };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    e.posSum += r.position * r.impressions;
    qNow.set(r.query, e);
  }
  const topQuestions = [...qNow.values()]
    .map((e) => ({ query: e.query, clicks: e.clicks, impressions: e.impressions, position: round(e.impressions ? e.posSum / e.impressions : 0) }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  const stats = posts ? contentStats(posts) : null;
  const bank = await questionBankMod.summary(days);
  const drafts = await prisma.drafts.findMany({
    where: { AND: [{ people_also_ask: { not: null } }, { people_also_ask: { not: '[]' } }], created_at: { gte: sqlNowOffset('-90 days') } },
    select: { people_also_ask: true },
  });
  let paaTotal = 0;
  let paaUsed = 0;
  for (const d of drafts) {
    try {
      for (const q of JSON.parse(d.people_also_ask)) {
        paaTotal++;
        if (q.used) paaUsed++;
      }
    } catch {
      /* ignore a malformed row */
    }
  }
  const aeoStatus = qClicksBefore + qClicksNow < 10 ? 'watch' : light(pct(qClicksNow, qClicksBefore));
  const aeo = {
    status: aeoStatus,
    kpis: [
      kpi('Clicks from question searches', qClicksNow, qClicksBefore, { note: 'Searches that ask a question (how, what, can...)' }),
      kpi('Impressions on question searches', qImprNow, qImprBefore),
      kpi('Blog posts with an FAQ', stats?.withFaq ?? 0, stats?.withFaq ?? 0, { note: stats ? `${stats.faqPct}% of ${stats.posts} published posts` : 'WordPress not reachable' }),
      kpi('Google questions in the question bank', bank.total, bank.total, { note: `${bank.newCount} confirmed new in ${days} days` }),
      kpi('Google questions answered in recent drafts', paaUsed, paaUsed, { note: paaTotal ? `${paaUsed} of ${paaTotal} in drafts from the last 90 days` : 'No recent drafts yet' }),
    ],
    series: {
      labels,
      questionClicks: bucketSum(questionRows, buckets, (r) => r.clicks),
      questionImpressions: bucketSum(questionRows, buckets, (r) => r.impressions),
    },
    topQuestions,
    content: stats,
    questionBank: bank,
    notMeasurable: 'Featured snippet wins and People Also Ask appearances of our pages are not available from any connected tool.',
  };
  aeo.headline = `${qClicksNow} clicks came from question-style searches (${pct(qClicksNow, qClicksBefore) === null ? 'no earlier period' : `${pct(qClicksNow, qClicksBefore) >= 0 ? '+' : ''}${pct(qClicksNow, qClicksBefore)}%`}). ${stats ? `${stats.faqPct}% of published posts have an FAQ.` : ''}`.trim();

  // ---------- GEO ----------
  const aiNow = sumRange(ai, w.current, (r) => r.sessions);
  const aiBefore = sumRange(ai, w.previous, (r) => r.sessions);
  const aiConvNow = sumRange(ai, w.current, (r) => r.conversions);
  const aiConvBefore = sumRange(ai, w.previous, (r) => r.conversions);
  const bySource: any = {};
  for (const r of ai.filter((x) => inRange(x.date, w.current))) bySource[r.source] = (bySource[r.source] || 0) + r.sessions;
  const sources = Object.entries(bySource).map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions);
  const sourceNames = [...new Set(ai.map((r) => r.source))];
  const strat = await prisma.seo_strategies.findFirst({
    where: { report_json: { not: null }, status: { not: 'rejected' } },
    select: { created_at: true, data_snapshot: true },
    orderBy: { id: 'desc' },
  });
  let overview: any = null;
  if (strat) {
    try {
      const a = JSON.parse(strat.data_snapshot).analysis || {};
      if (a.aiVisibilitySummary) overview = { ...a.aiVisibilitySummary, checkedAt: strat.created_at, rows: (a.aiVisibility || []).filter((r) => !r.error) };
    } catch {
      /* ignore an unreadable snapshot */
    }
  }
  const brandChange = pct(brandNow, brandBefore);
  const geoChange = pct(aiNow, aiBefore);
  let geoStatus = light(geoChange, { good: 10, bad: -25 });
  if (aiNow + aiBefore < 10) geoStatus = 'watch';
  if (overview && overview.withAiOverview > 0 && overview.citingUs === 0 && geoStatus === 'good') geoStatus = 'watch';
  const geo = {
    status: geoStatus,
    kpis: [
      kpi('Visits from AI assistants', aiNow, aiBefore, { note: 'ChatGPT, Gemini, Claude, Perplexity, Copilot (GA4)' }),
      kpi('Conversions from AI visits', aiConvNow, aiConvBefore),
      kpi('Brand-name searches (clicks)', brandNow, brandBefore, { note: 'People who search for USAIndiaCFO after seeing it mentioned' }),
      kpi('Posts updated in the last 90 days', stats?.fresh90 ?? 0, stats?.fresh90 ?? 0, { note: stats ? `${stats.fresh90Pct}% of posts. AI answers favour recently updated pages` : 'WordPress not reachable' }),
      kpi('AI Overviews that cite us', overview?.citingUs ?? 0, overview?.citingUs ?? 0, { note: overview ? `of ${overview.withAiOverview} with an AI Overview, ${overview.checked} keywords checked ${String(overview.checkedAt).slice(0, 10)}` : 'Generate a strategy to run this check' }),
    ],
    series: {
      labels,
      aiVisits: bucketSum(ai, buckets, (r) => r.sessions),
      brandClicks: bucketSum(brandRows, buckets, (r) => r.clicks),
      bySource: sourceNames.slice(0, 5).map((s) => ({ source: s, values: bucketSum(ai.filter((r) => r.source === s), buckets, (r) => r.sessions) })),
    },
    sources,
    overview,
    content: stats,
    notMeasurable: 'Mentions inside ChatGPT, Perplexity or Gemini answers that nobody clicks cannot be counted with the connected tools.',
  };
  geo.headline = `${aiNow} visits came from AI assistants (${geoChange === null ? 'no earlier period' : `${geoChange >= 0 ? '+' : ''}${geoChange}%`}). ${overview ? `Google AI Overviews cite us for ${overview.citingUs} of ${overview.withAiOverview} keywords that show one.` : ''}`.trim();

  // ---------- Overall ----------
  const rank = { good: 2, watch: 1, bad: 0, unknown: 1 };
  const statuses = [seo.status, aeo.status, geo.status];
  const avg = statuses.reduce((s, x) => s + rank[x], 0) / statuses.length;
  const overallStatus = statuses.includes('bad') && avg < 1 ? 'bad' : avg >= 1.6 ? 'good' : 'watch';
  const overall = {
    status: overallStatus,
    items: [
      { pillar: 'SEO', status: seo.status, headline: seo.headline },
      { pillar: 'AEO', status: aeo.status, headline: aeo.headline },
      { pillar: 'GEO', status: geo.status, headline: geo.headline },
    ],
  };

  return {
    generatedAt: new Date().toISOString(),
    days,
    ranges: { current: w.current, previous: w.previous },
    dataNotes: eventsAffecting({ current: w.current, previous: w.previous }).map((e) => `${e.start}${e.end ? ` to ${e.end}` : ' onward'}: ${e.note}`),
    seo,
    aeo,
    geo,
    overall,
    errors,
  };
}

const cache = new Map();
async function cachedPerformance(days = 28, { fresh = false }: any = {}) {
  const hit = cache.get(days);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const data = await gatherPerformance(days);
  cache.set(days, { at: Date.now(), data });
  return data;
}

export { gatherPerformance, cachedPerformance, windows, weekBuckets, bucketSum, sumRange, inRange, pct, round, ga4Report, gaDate, wordpressPosts, addDays, iso };

// Shared with lib/blogAnalytics.js

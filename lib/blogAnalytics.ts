// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as perf from './performanceReport';
import { querySearchAnalytics } from './searchConsole';
import { wpRequest } from './wordpress';
// Analytics for ONE blog (by URL) and a league table of all blogs: clicks, impressions, position,
// visits, engagement, conversions, and the exact keywords (Google searches) the page ranks for,
// each compared with the previous period. Read-only, from Search Console, GA4 and WordPress.


const { windows, weekBuckets, bucketSum, sumRange, inRange, pct, round, ga4Report, gaDate, addDays } = perf;
const BRAND = /usa? ?-?india ?-?cfo|usaindia/i;
const QUESTION = /^(how|what|why|when|where|which|who|can|could|does|do|did|is|are|was|were|will|should|would|need)\b|\?$/i;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decode = (s) => String(s || '').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/&#038;|&amp;/g, '&').replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#8230;/g, '...');

function siteHost() {
  return new URL(process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').hostname.replace(/^www\./, '');
}

// Accepts only URLs on our own site; returns { url, path }.
function parseBlogUrl(input) {
  let u: any;
  try {
    u = new URL(input);
  } catch {
    throw Object.assign(new Error('That is not a valid URL.'), { status: 400 });
  }
  if (u.hostname.replace(/^www\./, '') !== siteHost()) throw Object.assign(new Error(`Analytics are only available for pages on ${siteHost()}.`), { status: 400 });
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { url: `${u.origin}${path}`, path };
}

function isLive(url) {
  return !/[?&](p|page_id|preview)=/i.test(url);
}

const pageFilter = (url) => [{ dimension: 'page', operator: 'includingRegex', expression: `^${escapeRe(url)}/?$` }];

function ga4Filter(path, extra) {
  const landing = { filter: { fieldName: 'landingPage', stringFilter: { matchType: 'FULL_REGEXP', value: `${escapeRe(path)}/?`, caseSensitive: false } } };
  return extra ? { andGroup: { expressions: [landing, extra] } } : landing;
}

// Search Console and GA4 answers change slowly, so each answer is kept for 10 minutes (the Drafts
// page and every opened draft ask for them; ?fresh=1 asks again).
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: any }>();
async function cached(key: string, fresh: boolean, fn: () => Promise<any>) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return data;
}

async function getBlogAnalytics(inputUrl, { days = 28, keyword = '', fresh = false }: any = {}) {
  return cached(`one|${inputUrl}|${days}|${keyword}`, fresh, () => blogAnalytics(inputUrl, { days, keyword }));
}

async function blogAnalytics(inputUrl, { days = 28, keyword = '' }: any = {}) {
  const { url, path } = parseBlogUrl(inputUrl);
  const live = isLive(inputUrl);
  if (!live) return { url, live: false, message: 'This page is not live yet (it is a WordPress draft or preview), so Google has no data for it. Analytics appear a few days after it is published.' };

  const w = windows(days);
  const buckets = weekBuckets(w.end, w.weeks);
  const range = { startDate: w.seriesStart, endDate: w.end };
  const filters = pageFilter(url);
  const errors: any = {};
  const safe = (name, fn) => fn().catch((e: any) => ((errors[name] = e.message), null));

  const [daily, qCur, qPrev, countries, gaDaily, gaChannels] = await Promise.all([
    safe('searchConsole', () => querySearchAnalytics({ ...range, dimensions: ['date'], rowLimit: 1000, filters })),
    safe('keywords', () => querySearchAnalytics({ ...w.current, dimensions: ['query'], rowLimit: 500, filters })),
    safe('keywordsBefore', () => querySearchAnalytics({ ...w.previous, dimensions: ['query'], rowLimit: 500, filters })),
    safe('countries', () => querySearchAnalytics({ ...w.current, dimensions: ['country'], rowLimit: 10, filters })),
    safe('ga4', () =>
      ga4Report({
        dateRanges: [{ startDate: w.seriesStart, endDate: w.end }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'conversions' }],
        dimensionFilter: ga4Filter(path),
        limit: 1000,
      })
    ),
    safe('ga4Channels', () =>
      ga4Report({
        dateRanges: [{ startDate: w.current.startDate, endDate: w.current.endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'conversions' }, { name: 'averageSessionDuration' }],
        dimensionFilter: ga4Filter(path),
        limit: 20,
      })
    ),
  ]);

  const days_ = (daily || []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const ga = (gaDaily || []).map((r) => ({ date: gaDate(r.dimensionValues[0].value), sessions: Number(r.metricValues[0].value), engaged: Number(r.metricValues[1].value), conversions: Number(r.metricValues[2].value) }));
  const posOf = (range_) => {
    const sel = days_.filter((r) => inRange(r.date, range_));
    const impr = sel.reduce((s, r) => s + r.impressions, 0);
    return impr ? sel.reduce((s, r) => s + r.position * r.impressions, 0) / impr : null;
  };
  const kpi = (label, now, before, o = {}) => ({ label, now: round(now, o.digits ?? 0), before: round(before, o.digits ?? 0), changePct: pct(now, before), unit: o.unit || '', lowerIsBetter: Boolean(o.lowerIsBetter), note: o.note || '' });

  const c = (pick, r) => sumRange(days_, r, pick);
  const clicksN = c((r) => r.clicks, w.current);
  const clicksB = c((r) => r.clicks, w.previous);
  const imprN = c((r) => r.impressions, w.current);
  const imprB = c((r) => r.impressions, w.previous);
  const sessN = sumRange(ga, w.current, (r) => r.sessions);
  const sessB = sumRange(ga, w.previous, (r) => r.sessions);
  const engN = sumRange(ga, w.current, (r) => r.engaged);
  const engB = sumRange(ga, w.previous, (r) => r.engaged);
  const convN = sumRange(ga, w.current, (r) => r.conversions);
  const convB = sumRange(ga, w.previous, (r) => r.conversions);

  // Keywords this page ranks for, with the previous period beside each.
  const before = new Map((qPrev || []).map((r) => [r.keys[0], r]));
  const primary = String(keyword || '').toLowerCase().trim();
  const keywords = (qCur || [])
    .map((r) => {
      const q = r.keys[0];
      const b = before.get(q);
      const position = round(r.position);
      return {
        query: q,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: round(r.ctr * 100, 2),
        position,
        positionBefore: b ? round(b.position) : null,
        clicksBefore: b ? b.clicks : 0,
        isNew: !b,
        kind: BRAND.test(q) ? 'brand' : QUESTION.test(q.trim()) ? 'question' : q.split(/\s+/).length >= 4 ? 'long-tail' : 'short',
        isTarget: primary ? q.toLowerCase() === primary || q.toLowerCase().includes(primary) : false,
        band: position <= 3 ? 'top 3' : position <= 10 ? 'page 1' : position <= 20 ? 'page 2' : 'below page 2',
      };
    })
    .sort((a, b) => b.impressions - a.impressions);

  const opportunities: any[] = [];
  const near = keywords.filter((k) => k.position > 3 && k.position <= 20 && k.impressions >= 20 && !BRAND.test(k.query)).sort((a, b) => b.impressions - a.impressions).slice(0, 4);
  for (const k of near) opportunities.push(`"${k.query}" is at position ${k.position} with ${k.impressions} impressions: ${k.position <= 10 ? 'improve the title, meta description and the answer at the top' : 'add depth, a section that answers it, and internal links'}.`);
  const lowCtr = keywords.filter((k) => k.position <= 10 && k.impressions >= 50 && k.ctr < 2 && !BRAND.test(k.query)).slice(0, 2);
  for (const k of lowCtr) opportunities.push(`"${k.query}" shows on page 1 but only ${k.ctr}% click: rewrite the title and meta description.`);
  const lost = [...before.values()].filter((b) => b.clicks >= 3 && !(qCur || []).some((r) => r.keys[0] === b.keys[0])).slice(0, 3);
  for (const b of lost) opportunities.push(`"${b.keys[0]}" brought ${b.clicks} clicks last period and no longer shows: check whether the page still answers it.`);
  if (primary && !keywords.some((k) => k.isTarget)) opportunities.push(`The target keyword "${keyword}" does not appear in Google's data for this page yet.`);

  const hasData = imprN + imprB > 0;
  const headline = !hasData
    ? 'Google has no search data for this page in this period (new pages take days to weeks to appear).'
    : `${clicksN} clicks and ${imprN.toLocaleString('en-US')} impressions in ${days} days (${pct(clicksN, clicksB) === null ? 'no earlier period' : `${pct(clicksN, clicksB) >= 0 ? '+' : ''}${pct(clicksN, clicksB)}%`} clicks vs the period before). It ranks for ${keywords.length} searches, ${keywords.filter((k) => k.position <= 10).length} of them on page 1.`;

  return {
    url,
    live: true,
    days,
    ranges: { current: w.current, previous: w.previous },
    hasData,
    headline,
    kpis: [
      kpi('Google clicks', clicksN, clicksB),
      kpi('Impressions', imprN, imprB),
      kpi('Click-through rate', imprN ? (clicksN / imprN) * 100 : 0, imprB ? (clicksB / imprB) * 100 : 0, { digits: 2, unit: '%' }),
      kpi('Average position', posOf(w.current) ?? 0, posOf(w.previous) ?? 0, { digits: 1, lowerIsBetter: true }),
      kpi('Visits (all sources, GA4)', sessN, sessB),
      kpi('Engaged visits', engN, engB, { note: sessN ? `${round((engN / sessN) * 100)}% of visits` : '' }),
      kpi('Conversions (GA4)', convN, convB),
    ],
    series: {
      labels: buckets.map((b) => b.start.slice(5)),
      clicks: bucketSum(days_, buckets, (r) => r.clicks),
      impressions: bucketSum(days_, buckets, (r) => r.impressions),
      visits: bucketSum(ga, buckets, (r) => r.sessions),
    },
    splitAt: buckets.length - Math.round(days / 7),
    keywords: keywords.slice(0, 60),
    keywordCount: keywords.length,
    countries: (countries || []).map((r) => ({ country: r.keys[0].toUpperCase(), clicks: r.clicks, impressions: r.impressions })),
    channels: (gaChannels || []).map((r) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), engaged: Number(r.metricValues[1].value), conversions: Number(r.metricValues[2].value), avgSeconds: round(Number(r.metricValues[3].value)) })).sort((a, b) => b.sessions - a.sessions),
    opportunities,
    errors,
  };
}

// All published blogs ranked by Google clicks, with their top keywords and the change vs before.
async function getBlogTable({ days = 28, fresh = false }: any = {}) {
  return cached(`table|${days}`, fresh, () => blogTable({ days }));
}

async function blogTable({ days = 28 }: any = {}) {
  const w = windows(days);
  const errors: any = {};
  const safe = (name, fn) => fn().catch((e: any) => ((errors[name] = e.message), null));
  const [cur, prev, pq, posts] = await Promise.all([
    safe('pages', () => querySearchAnalytics({ ...w.current, dimensions: ['page'], rowLimit: 2000 })),
    safe('pagesBefore', () => querySearchAnalytics({ ...w.previous, dimensions: ['page'], rowLimit: 2000 })),
    safe('keywords', () => querySearchAnalytics({ ...w.current, dimensions: ['page', 'query'], rowLimit: 25000 })),
    safe('wordpress', async () => {
      const out: any[] = [];
      for (let page = 1; page <= 6; page++) {
        const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { per_page: 100, page, status: 'publish', _fields: 'id,link,title,date,modified' } });
        out.push(...json);
        if (json.length < 100) break;
      }
      return out;
    }),
  ]);
  const norm = (u) => u.replace(/\/+$/, '');
  const prevMap = new Map((prev || []).map((r) => [norm(r.keys[0]), r]));
  const curMap = new Map((cur || []).map((r) => [norm(r.keys[0]), r]));
  const topQ = new Map();
  for (const r of pq || []) {
    const k = norm(r.keys[0]);
    if (!topQ.has(k)) topQ.set(k, []);
    topQ.get(k).push({ query: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: round(r.position) });
  }
  const rows = (posts || []).map((p) => {
    const k = norm(p.link);
    const c = curMap.get(k);
    const b = prevMap.get(k);
    const qs = (topQ.get(k) || []).filter((q) => !BRAND.test(q.query)).sort((a, b2) => b2.impressions - a.impressions);
    return {
      title: decode(p.title?.rendered) || p.link,
      url: p.link,
      published: String(p.date).slice(0, 10),
      modified: String(p.modified).slice(0, 10),
      clicks: c?.clicks || 0,
      clicksBefore: b?.clicks || 0,
      change: (c?.clicks || 0) - (b?.clicks || 0),
      impressions: c?.impressions || 0,
      position: c ? round(c.position) : null,
      keywordCount: (topQ.get(k) || []).length,
      topKeywords: qs.slice(0, 3),
    };
  });
  rows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return {
    days,
    ranges: { current: w.current, previous: w.previous },
    total: rows.length,
    withTraffic: rows.filter((r) => r.clicks > 0).length,
    noImpressions: rows.filter((r) => r.impressions === 0).length,
    rows: rows.slice(0, 150),
    errors,
  };
}

export { getBlogAnalytics, getBlogTable, parseBlogUrl };

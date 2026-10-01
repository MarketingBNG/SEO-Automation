// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import prisma from './prisma';
import { sqlNowOffset } from './time';
import { querySearchAnalytics, comparisonRanges } from './searchConsole';
import { getSummaryForRange, getOrganicLandingPages } from './ga4';
import { listSites, getSiteRankings } from './seranking';
// Month-over-month numbers computed in code (not by the AI) so the monthly report's figures are
// exact. Each block fails independently.


const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const round = (n, d = 1) => (typeof n === 'number' ? Math.round(n * 10 ** d) / 10 ** d : n);

function totalsRow(rows) {
  const r = rows[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position) };
}

function movers(currentRows, previousRows, limit = 10) {
  const prev = new Map(previousRows.map((r) => [r.keys[0], r]));
  const cur = new Map(currentRows.map((r) => [r.keys[0], r]));
  const keys = new Set([...prev.keys(), ...cur.keys()]);
  const diffs = [...keys].map((k) => {
    const c = cur.get(k);
    const p = prev.get(k);
    return {
      key: k,
      clicksNow: c?.clicks || 0,
      clicksBefore: p?.clicks || 0,
      clickChange: (c?.clicks || 0) - (p?.clicks || 0),
      impressionsNow: c?.impressions || 0,
      positionNow: c ? round(c.position) : null,
      positionBefore: p ? round(p.position) : null,
    };
  });
  return {
    gainers: diffs.filter((d) => d.clickChange > 0).sort((a, b) => b.clickChange - a.clickChange).slice(0, limit),
    losers: diffs.filter((d) => d.clickChange < 0).sort((a, b) => a.clickChange - b.clickChange).slice(0, limit),
  };
}

async function searchConsoleBlock(days) {
  const { current, previous } = comparisonRanges(days);
  const [curTotals, prevTotals, curQueries, prevQueries, curPages, prevPages] = await Promise.all([
    querySearchAnalytics({ ...current, dimensions: [], rowLimit: 1 }),
    querySearchAnalytics({ ...previous, dimensions: [], rowLimit: 1 }),
    querySearchAnalytics({ ...current, dimensions: ['query'], rowLimit: 1000 }),
    querySearchAnalytics({ ...previous, dimensions: ['query'], rowLimit: 1000 }),
    querySearchAnalytics({ ...current, dimensions: ['page'], rowLimit: 500 }),
    querySearchAnalytics({ ...previous, dimensions: ['page'], rowLimit: 500 }),
  ]);

  const now = totalsRow(curTotals);
  const before = totalsRow(prevTotals);
  const query = (r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position) });
  const previousQueries = new Set(prevQueries.map((r) => r.keys[0]));

  return {
    ranges: { current, previous },
    totals: {
      now,
      before,
      change: {
        clicksPct: pct(now.clicks, before.clicks),
        impressionsPct: pct(now.impressions, before.impressions),
        ctrPoints: round(now.ctr - before.ctr, 2),
        positionChange: round(now.position - before.position),
      },
    },
    queryMovers: movers(curQueries, prevQueries),
    pageMovers: movers(curPages, prevPages),
    // Page-2 / bottom-of-page-1 queries with real demand: the cheapest wins.
    strikingDistance: curQueries
      .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 10)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20)
      .map(query),
    // Already ranking on page 1 but rarely clicked: title / meta description rewrite candidates.
    lowCtrOnPageOne: curQueries
      .filter((r) => r.position <= 10 && r.impressions >= 50 && r.ctr < 0.02)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)
      .map(query),
    newQueries: curQueries
      .filter((r) => !previousQueries.has(r.keys[0]) && r.impressions >= 10)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)
      .map(query),
  };
}

async function ga4Block(days) {
  const { current, previous } = comparisonRanges(days);
  const [allNow, allBefore, organicNow, organicBefore, organicPages] = await Promise.all([
    getSummaryForRange(current.startDate, current.endDate),
    getSummaryForRange(previous.startDate, previous.endDate),
    getSummaryForRange(current.startDate, current.endDate, { organicOnly: true }),
    getSummaryForRange(previous.startDate, previous.endDate, { organicOnly: true }),
    getOrganicLandingPages(current.startDate, current.endDate, 25),
  ]);
  return {
    allTraffic: { now: allNow, before: allBefore, sessionsPct: pct(allNow.sessions, allBefore.sessions), conversionsPct: pct(allNow.conversions, allBefore.conversions) },
    organic: {
      now: organicNow,
      before: organicBefore,
      sessionsPct: pct(organicNow.sessions, organicBefore.sessions),
      conversionsPct: pct(organicNow.conversions, organicBefore.conversions),
    },
    organicLandingPages: organicPages,
    trafficButNoConversions: organicPages.filter((p) => p.sessions >= 20 && p.conversions === 0).slice(0, 10),
  };
}

async function rankingsBlock() {
  const sites = await listSites();
  if (!sites.length) return { note: 'No SE Ranking project' };
  const rows = await getSiteRankings(sites[0].id);
  const bucket = (p) => (!p ? 'notRanked' : p <= 3 ? 'top3' : p <= 10 ? 'top4to10' : p <= 20 ? 'top11to20' : 'top21to100');
  const distribution = { top3: 0, top4to10: 0, top11to20: 0, top21to100: 0, notRanked: 0 };
  for (const r of rows) distribution[bucket(r.position)]++;
  return {
    trackedKeywords: rows.length,
    distribution,
    improvedToday: rows.filter((r) => r.change > 0).length,
    declinedToday: rows.filter((r) => r.change < 0).length,
    keywords: rows.slice(0, 40),
  };
}

async function contentShippedBlock(days) {
  const since = sqlNowOffset(`-${days} days`);
  return {
    draftsCreated: await prisma.drafts.count({ where: { created_at: { gte: since } } }),
    postsPublished: await prisma.drafts.count({ where: { status: 'published', updated_at: { gte: since } } }),
    auditsRun: await prisma.blog_audits.count({ where: { created_at: { gte: since } } }),
    postsRefreshed: await prisma.blog_audits.count({ where: { rewrite_status: 'published', wp_post_id: { not: null }, created_at: { gte: since } } }),
    websiteChangesByAssistant: await prisma.site_changes.count({ where: { status: 'applied', created_at: { gte: since } } }),
    publishedTitles: await prisma.drafts.findMany({
      where: { status: 'published', updated_at: { gte: since } },
      select: { title: true, wp_post_url: true },
      orderBy: { id: 'desc' },
      take: 20,
    }),
  };
}

async function gatherMonthlyMetrics(days = 28) {
  const metrics = { periodDays: days, errors: {} };
  const blocks = {
    searchConsole: () => searchConsoleBlock(days),
    ga4: () => ga4Block(days),
    rankings: () => rankingsBlock(),
  };
  const entries = Object.entries(blocks);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
  settled.forEach((r, i) => {
    const name = entries[i][0];
    if (r.status === 'fulfilled') metrics[name] = r.value;
    else metrics.errors[name] = r.reason?.message || String(r.reason);
  });
  metrics.contentShipped = await contentShippedBlock(30);
  return metrics;
}

export { gatherMonthlyMetrics };

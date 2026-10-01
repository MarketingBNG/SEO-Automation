// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as searchConsoleMod from './searchConsole';
import * as questionBankMod from './questionBank';
import prisma from './prisma';
import { RELIABLE_IMPRESSIONS_FROM, eventsAffecting, upcomingDeadlines } from './seoCalendar';
import { wpRequest } from './wordpress';
import { liveSearch } from './serphouse';
import { aiOverviewSummary, peopleAlsoAsk } from './researchBrief';
import { listSites, getSiteRankings } from './seranking';
import { getAiReferrals } from './ga4';
// The monthly strategy's analysis, computed in code from the connected tools so every number in
// the report is exact and every recommendation's inputs are visible. Method from the verified
// strategy research: measurement hygiene first, then decay types, striking distance split into
// click and ranking problems, cannibalization, cohorts of past work, regulatory refresh triggers,
// AI Overview visibility, and a transparent backlog score.


const SITE_HOST = 'usaindiacfo.com';
const BRAND_REGEX = '(?i)usa? ?-?india ?-?cfo|usaindia';
const DAY = 24 * 60 * 60 * 1000;

const round = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const pct = (cur, prev) => (prev ? round(((cur - prev) / prev) * 100) : null);
const fmt = (d) => d.toISOString().slice(0, 10);

const abortError = () => Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError();
};
// Settles with the promise, or rejects as soon as the signal aborts, so Stop ends the run at
// once. A call that cannot take a signal (Search Console, WordPress) finishes in the background,
// and its result is ignored.
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function gsc() {
  return searchConsoleMod;
}

// Two back-to-back windows ending 2 days ago. Longer windows are steadier, but both must start on
// or after the date Search Console impressions became reliable again, so early on they are shorter.
function reliableRanges(maxDays = 90) {
  const end = new Date(Date.now() - 2 * DAY);
  const available = Math.floor((end - new Date(`${RELIABLE_IMPRESSIONS_FROM}T00:00:00Z`)) / DAY) + 1;
  const days = Math.max(14, Math.min(maxDays, Math.floor(available / 2)));
  return { days, ...gsc().comparisonRanges(days) };
}

// Click-through rate by position from the site's own NON-BRANDED queries (brand searches click at
// ~35% at position 1 and would inflate every estimate). Where the site has too little data at a
// position, a standard curve is scaled to the site's observed level. The curve is then fitted to
// be non-increasing (pool adjacent violators, weighted by impressions), so a better position is
// never worth fewer clicks and one odd bucket (for example queries answered by an AI Overview,
// which Google credits at about position 1 with few clicks) is averaged with its neighbours
// instead of capping every lower position. No position drops below the share of clicks a page
// keeps under an AI Overview that does not cite it, so one bad bucket cannot zero the backlog.
const DEFAULT_CTR = { 1: 0.25, 2: 0.14, 3: 0.09, 4: 0.065, 5: 0.05, 6: 0.04, 7: 0.032, 8: 0.026, 9: 0.022, 10: 0.019 };
const defaultCtr = (p) => DEFAULT_CTR[p] ?? Math.max(0.004, 0.019 - (p - 10) * 0.0015);
const CTR_ESTIMATE_WEIGHT = 100; // an estimated position counts like 100 impressions in the fit
const CTR_FLOOR_SHARE = 0.28; // Seer (April 2026): clicks kept under an AI Overview that does not cite you
function ctrCurve(nonBrandedQueryRows) {
  const buckets: any = {};
  for (const r of nonBrandedQueryRows) {
    const p = Math.max(1, Math.round(r.position));
    if (p > 20) continue;
    buckets[p] = buckets[p] || { clicks: 0, impressions: 0 };
    buckets[p].clicks += r.clicks;
    buckets[p].impressions += r.impressions;
  }
  const measured = Object.entries(buckets)
    .filter(([, b]) => b.impressions >= 300)
    .map(([p, b]) => [Number(p), { ctr: b.clicks / b.impressions, impressions: b.impressions }]);
  const ratios = measured.map(([p, m]) => m.ctr / defaultCtr(p)).sort((a, b) => a - b);
  const scale = ratios.length ? Math.min(1.5, Math.max(0.1, ratios[Math.floor(ratios.length / 2)])) : 1;
  const site = new Map(measured);

  const points: any[] = [];
  for (let p = 1; p <= 20; p++) {
    const m = site.get(p);
    points.push(m ? { ctr: m.ctr, weight: m.impressions, source: 'site' } : { ctr: defaultCtr(p) * scale, weight: CTR_ESTIMATE_WEIGHT, source: 'estimated' });
  }
  const blocks: any[] = [];
  for (const pt of points) {
    blocks.push({ sum: pt.ctr * pt.weight, weight: pt.weight, size: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.weight >= last.sum / last.weight) break;
      blocks.pop();
      prev.sum += last.sum;
      prev.weight += last.weight;
      prev.size += last.size;
    }
  }
  const fitted = blocks.flatMap((b) => Array(b.size).fill(b.sum / b.weight));

  const curve: any = {};
  points.forEach((pt, i) => {
    const p = i + 1;
    curve[p] = { ctr: Math.max(fitted[i], defaultCtr(p) * scale * CTR_FLOOR_SHARE), source: pt.source };
  });
  return curve;
}

const BRAND = new RegExp(BRAND_REGEX.replace('(?i)', ''), 'i');
const isBranded = (query) => BRAND.test(query);

function nonBrandedFilter() {
  return [{ dimension: 'query', operator: 'excludingRegex', expression: BRAND_REGEX }];
}

// KPI scoreboard inputs. Non-branded clicks = all clicks minus clicks on brand searches, per the
// research method: Google hides rare (anonymized) queries from query-level data, so filtering for
// "not brand" would silently drop them, and they are almost never brand searches. Branded clicks
// mostly reflect existing demand, not SEO wins.
async function marketScoreboard(ranges) {
  const q = gsc().querySearchAnalytics;
  const byCountry = (rows) => {
    const out = { US: 0, India: 0, other: 0 };
    for (const r of rows) {
      const c = r.keys[0];
      if (c === 'usa') out.US += r.clicks;
      else if (c === 'ind') out.India += r.clicks;
      else out.other += r.clicks;
    }
    return out;
  };
  const brandFilter = [{ dimension: 'query', operator: 'includingRegex', expression: BRAND_REGEX }];
  const [allNow, allBefore, brandNow, brandBefore] = await Promise.all([
    q({ ...ranges.current, dimensions: ['country'], rowLimit: 250 }),
    q({ ...ranges.previous, dimensions: ['country'], rowLimit: 250 }),
    q({ ...ranges.current, dimensions: ['country'], rowLimit: 250, filters: brandFilter }),
    q({ ...ranges.previous, dimensions: ['country'], rowLimit: 250, filters: brandFilter }),
  ]);
  const minus = (a, b) => ({ US: a.US - b.US, India: a.India - b.India, other: a.other - b.other });
  const now = minus(byCountry(allNow), byCountry(brandNow));
  const before = minus(byCountry(allBefore), byCountry(brandBefore));
  const sum = (o) => o.US + o.India + o.other;
  return {
    nonBrandedClicks: {
      now: { ...now, total: sum(now) },
      before: { ...before, total: sum(before) },
      changePct: { US: pct(now.US, before.US), India: pct(now.India, before.India), total: pct(sum(now), sum(before)) },
      note: 'Includes clicks from queries Google anonymizes.',
    },
    brandedClicks: { now: sum(byCountry(brandNow)), before: sum(byCountry(brandBefore)) },
  };
}

// Striking distance: positions 4-20 with real demand, ranked by clicks gained at position 3.
// 4-10 are click problems (title, meta, answer block); 11-20 are ranking problems (depth,
// sub-questions, internal links, fresher facts).
// Uses the longer reliable window (more data for a small site); potential is per 28 days.
function strikingDistance(queryPageRows, curve, windowDays) {
  const target = curve[3].ctr;
  const per28 = 28 / windowDays;
  const rows = queryPageRows
    .filter((r) => !isBranded(r.keys[0]) && r.position >= 3.5 && r.position <= 20.5 && r.impressions >= 100)
    .map((r) => ({
      query: r.keys[0],
      page: r.keys[1],
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: round(r.ctr * 100, 2),
      position: round(r.position),
      potentialExtraClicks: Math.max(0, Math.round(r.impressions * (target - r.ctr) * per28)),
      windowDays,
    }))
    .sort((a, b) => b.potentialExtraClicks - a.potentialExtraClicks);
  return {
    clickProblems: rows.filter((r) => r.position <= 10).slice(0, 15),
    rankingProblems: rows.filter((r) => r.position > 10).slice(0, 15),
  };
}

// Classifies pages that lost clicks by the pattern of the loss, because each needs a different
// fix: ranking decay (upgrade the content), zero-click capture (AI Overview took the click: rework
// the answer and title, not a rewrite), demand decay (deprioritize or time it to a deadline), and
// lost (the page no longer shows in Google results at all: deindexed, broken, or redirected, which
// is fine when the redirect was on purpose, for example after a merge).
// currentComplete is false when the current list hit the row limit, because then a page missing
// from it may only have fallen below the cut.
function decayTypes(curPages, prevPages, { currentComplete = true }: any = {}) {
  const cur = new Map(curPages.map((r) => [r.keys[0], r]));
  const out: any[] = [];
  for (const p of prevPages) {
    if (p.clicks < 10) continue;
    const page = p.keys[0];
    const c = cur.get(page);
    if (!c) {
      if (!currentComplete) continue;
      out.push({
        page,
        type: 'lost',
        clicksNow: 0,
        clicksBefore: p.clicks,
        clicksPct: -100,
        impressionsPct: -100,
        positionNow: null,
        positionBefore: round(p.position),
        clicksLost: p.clicks,
      });
      continue;
    }
    // Only real losses: a page can gain clicks while its average position gets worse (it starts
    // showing for more long-tail queries lower down).
    if (c.clicks >= p.clicks) continue;
    const clicksPct = pct(c.clicks, p.clicks);
    const imprPct = pct(c.impressions, p.impressions);
    const posDelta = round(c.position - p.position); // positive = worse
    const ctrNow = c.ctr;
    const ctrBefore = p.ctr;
    const clicksDown = clicksPct !== null && clicksPct <= -20;
    const positionDrop = posDelta > 5;
    const ctrFallStableImpr = Math.abs(imprPct ?? 0) <= 15 && ctrBefore > 0 && ctrNow / ctrBefore <= 0.75;
    if (!clicksDown && !positionDrop && !ctrFallStableImpr) continue;
    if (p.position <= 4 && Math.abs(posDelta) <= 2 && !clicksDown) continue; // minor slip at the top

    let type = 'mixed';
    if ((imprPct ?? 0) <= -10 && posDelta > 1.5) type = 'ranking_decay';
    else if ((imprPct ?? 0) >= -10 && Math.abs(posDelta) <= 1.5) type = 'zero_click_capture';
    else if ((imprPct ?? 0) < -10 && posDelta <= 1.5) type = 'demand_decay';
    else if (positionDrop) type = 'ranking_decay';

    out.push({
      page,
      type,
      clicksNow: c.clicks,
      clicksBefore: p.clicks,
      clicksPct,
      impressionsPct: imprPct,
      positionNow: round(c.position),
      positionBefore: round(p.position),
      clicksLost: p.clicks - c.clicks,
    });
  }
  return out.sort((a, b) => b.clicksLost - a.clicksLost).slice(0, 15);
}

// Queries where two or more of our URLs split the impressions: a merge-and-redirect candidate if
// the live results show both serve the same intent (never canonical, noindex or delete).
function cannibalization(queryPageRows) {
  const byQuery = new Map();
  for (const r of queryPageRows) {
    const [query, page] = r.keys;
    if (isBranded(query)) continue; // brand searches rightly show several of our pages
    if (!byQuery.has(query)) byQuery.set(query, []);
    byQuery.get(query).push({ page, impressions: r.impressions, clicks: r.clicks, position: round(r.position) });
  }
  const out: any[] = [];
  for (const [query, pages] of byQuery) {
    const total = pages.reduce((s, p) => s + p.impressions, 0);
    if (total < 50) continue;
    const contenders = pages
      .filter((p) => p.position <= 30 && p.impressions / total >= 0.15)
      .map((p) => ({ ...p, share: round((p.impressions / total) * 100) }));
    if (contenders.length >= 2) out.push({ query, impressions: total, pages: contenders.sort((a, b) => b.impressions - a.impressions) });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, 10);
}

// Posts published about 1, 3 and 6 months ago, with what they earn now: the feedback loop on
// whether past monthly picks worked. Pages not in the top 10 by 6 months go back to the backlog.
async function cohorts(pageRowsLast28, signal) {
  const byUrl = new Map(pageRowsLast28.map((r) => [r.keys[0].replace(/\/+$/, ''), r]));
  const windows = [
    { label: '1 month ago', fromDays: 45, toDays: 15, checkpoint: 30 },
    { label: '3 months ago', fromDays: 105, toDays: 75, checkpoint: 90 },
    { label: '6 months ago', fromDays: 195, toDays: 165, checkpoint: 180 },
  ];
  const out: any[] = [];
  for (const w of windows) {
    throwIfAborted(signal);
    const after = new Date(Date.now() - w.fromDays * DAY).toISOString();
    const before = new Date(Date.now() - w.toDays * DAY).toISOString();
    const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { after, before, per_page: 50, _fields: 'id,title,link,date' } });
    const posts = (json || []).map((p) => {
      const g = byUrl.get(String(p.link).replace(/\/+$/, ''));
      return {
        id: p.id,
        title: String(p.title?.rendered || '').replace(/&#8217;/g, "'").replace(/&amp;/g, '&'),
        url: p.link,
        published: String(p.date).slice(0, 10),
        clicks28d: g?.clicks || 0,
        impressions28d: g?.impressions || 0,
        position: g ? round(g.position) : null,
        onTrack: w.checkpoint >= 180 ? Boolean(g && g.position <= 10) : w.checkpoint >= 90 ? Boolean(g && g.position <= 20) : Boolean(g),
      };
    });
    out.push({ ...w, posts });
  }
  return out;
}

// India's Income-tax Act 2025 applies from Tax Year 2026-27 and replaces the Assessment Year /
// Previous Year system, so India-tax posts that still use the old terms need a transition note.
// "Previous year" is plain English too (a US 401(k) or FBAR post uses it), so it only counts next
// to India tax wording. A post that already names the 2025 Act or a Tax Year has had its note.
const OLD_ACT_PATTERN = /assessment year|\bA\.?Y\.?\s?20\d\d|income[- ]tax act,?\s*1961/i;
const INDIA_TAX_CONTEXT = /india|\bNRIs?\b|\bITR\b|income[- ]tax|residential status|182 days|assessment/i;
const NEW_ACT_PATTERN = /income[- ]tax act,?\s*2025|tax year 20(?:2[6-9]|[3-9]\d)-\d\d/i; // Tax Year 2026-27 on is new-Act wording
function oldActWording(text) {
  if (NEW_ACT_PATTERN.test(text)) return null;
  const match = text.match(OLD_ACT_PATTERN);
  if (match) return match[0];
  for (const m of text.matchAll(/previous year/gi)) {
    if (INDIA_TAX_CONTEXT.test(text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80))) return m[0];
  }
  return null;
}
async function regulatoryRefresh(pageRowsLast28, signal) {
  const clicks = new Map(pageRowsLast28.map((r) => [r.keys[0].replace(/\/+$/, ''), r.clicks]));
  const found = new Map();
  // Quoted phrases: WordPress search otherwise matches each word on its own, and "act" matches
  // inside "contact" and "impact", which fills the 50 results with unrelated posts.
  for (const search of ['"assessment year"', '1961', '"income tax act"', '"income-tax act"', '"previous year"']) {
    throwIfAborted(signal);
    const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { search, per_page: 50, _fields: 'id,title,link,content,modified' } });
    for (const p of json || []) {
      if (found.has(p.id)) continue;
      const text = String(p.content?.rendered || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/\s+/g, ' ');
      const example = oldActWording(text);
      if (!example) continue;
      found.set(p.id, {
        id: p.id,
        title: String(p.title?.rendered || '').replace(/&#8217;/g, "'").replace(/&amp;/g, '&'),
        url: p.link,
        lastModified: String(p.modified).slice(0, 10),
        example,
        clicks28d: clicks.get(String(p.link).replace(/\/+$/, '')) || 0,
      });
    }
  }
  return [...found.values()].sort((a, b) => b.clicks28d - a.clicks28d).slice(0, 25);
}

const STEP_LABELS = {
  searchConsoleBase: 'Reading Search Console',
  scoreboard: 'Splitting branded and non-branded clicks',
  decay: 'Finding pages that are losing clicks',
  cohorts: 'Checking how past posts are doing',
  regulatoryRefresh: 'Scanning posts for Income-tax Act 1961 wording',
  trackedKeywords: 'Reading SE Ranking tracked keywords',
  aiVisibility: 'Checking Google AI Overviews',
  aiReferrals: 'Counting visits from ChatGPT, Perplexity, Gemini and other AI assistants',
};
const STEP_AT = { searchConsoleBase: 0, trackedKeywords: 0.05, aiVisibility: 0.1, scoreboard: 0.12, decay: 0.15, cohorts: 0.2, regulatoryRefresh: 0.25, aiReferrals: 0.27 };

// Once the signal aborts, no new item starts (each one may be a paid search).
async function mapLimit(items, limit, fn, signal) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !signal?.aborted) {
        const i = next++;
        results[i] = await fn(items[i]).catch((e: any) => ({ error: e.message }));
      }
    })
  );
  throwIfAborted(signal);
  return results;
}

// AI search visibility for the priority keywords, from live Google results: does an AI Overview
// show, does it cite usaindiacfo.com, and where do we rank organically.
async function aiOverviewVisibility(keywords, onEach, signal) {
  // SERPHouse live searches are slow; a timed-out search is not retried (it would double the wait),
  // other failures get one retry. A stopped run neither retries nor records the questions.
  // SERPHouse appears to queue parallel live searches per account, so run two at a time.
  const search = (keyword) => untilAborted(liveSearch({ q: keyword, loc: 'United States', timeoutMs: 120000, signal }), signal);
  const rows = await mapLimit(keywords, 2, async (keyword) => {
    const json = await search(keyword)
      .catch((e: any) => (e.name === 'TimeoutError' || signal?.aborted ? Promise.reject(e) : search(keyword)))
      .finally(() => onEach?.(keyword));
    throwIfAborted(signal);
    const organic = json.results?.results?.organic || [];
    const ours = organic.find((r) => String(r.link || '').includes(SITE_HOST));
    const overview = aiOverviewSummary(json);
    return {
      keyword,
      aiOverview: Boolean(overview),
      citesUs: Boolean(overview?.cited.some((h) => h.endsWith(SITE_HOST))),
      citedSites: overview?.cited.slice(0, 6) || [],
      organicPosition: ours ? ours.position : null,
      topCompetitors: organic.slice(0, 5).map((r) => {
        try {
          return new URL(r.link).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      }),
      peopleAlsoAsk: await (async () => {
        const paa = peopleAlsoAsk({ serp: json }).map((q) => ({ ...q, markets: ['US'] }));
        // PORT NOTE: recordQuestions is async now (never throws); awaited so a serverless function
        // cannot finish before the questions are saved.
        await questionBankMod.recordQuestions(keyword, paa);
        return paa.map((q) => q.question).slice(0, 4);
      })(),
    };
  });
  return rows.map((r, i) => (r?.error ? { keyword: keywords[i], error: r.error } : r));
}

// One row per keyword. A project that tracks several search engines (for example Google US and
// Google India) lists each keyword once per engine: the volumes are added up (total demand across
// the tracked markets) and the best position is kept.
function mergeEngines(tracked) {
  const rank = (pos) => (pos ? pos : Infinity); // 0 or null = not in the top 100
  const byKeyword = new Map();
  for (const t of tracked) {
    const key = String(t.keyword || '').trim().toLowerCase();
    if (!key) continue;
    const seen = byKeyword.get(key);
    if (!seen) {
      byKeyword.set(key, { ...t, engines: 1 });
      continue;
    }
    byKeyword.set(key, {
      ...seen,
      volume: seen.volume == null && t.volume == null ? null : (seen.volume || 0) + (t.volume || 0),
      position: rank(t.position) < rank(seen.position) ? t.position : seen.position,
      engines: seen.engines + 1,
    });
  }
  return [...byKeyword.values()];
}

// SE Ranking tracked keywords, with a check for which already have a page earning impressions
// (those are refresh candidates, never a second new page).
function trackedKeywordRouting(tracked, queryPageRows) {
  return mergeEngines(tracked).map((t) => {
    const kw = t.keyword.toLowerCase();
    const matches = queryPageRows.filter((r) => r.keys[0].toLowerCase() === kw && r.position <= 30);
    const best = matches.sort((a, b) => b.impressions - a.impressions)[0];
    return {
      keyword: t.keyword,
      volume: t.volume ?? null,
      sePosition: t.position || null,
      ...(t.engines > 1 ? { engines: t.engines } : {}),
      existingPage: best ? best.keys[1] : null,
      existingPosition: best ? round(best.position) : null,
      route: best ? 'refresh' : 'new',
    };
  });
}

// The tracked keywords the plan works from, so the prompt stays within its size as the SE Ranking
// project grows: the ones with a page already earning impressions, then the rest, each by volume.
const TRACKED_LIMIT = 40;
function selectTracked(routed) {
  const byVolume = (a, b) => (b.volume || 0) - (a.volume || 0);
  const withPage = routed.filter((t) => t.route === 'refresh').sort(byVolume).slice(0, TRACKED_LIMIT);
  const withoutPage = routed.filter((t) => t.route !== 'refresh').sort(byVolume).slice(0, TRACKED_LIMIT);
  return [...withPage, ...withoutPage];
}

// Backlog candidates with the traffic-potential part of the score filled in from data, on the
// research's 12-month basis (TP12 = extra clicks over the next 12 months) so refreshes and new
// pages compare fairly. The AI adds business value, confidence and effort; the priority itself is
// computed in code. Starting assumptions, labelled as such in the report and recalibrated from
// cohort results: a ranking fix holds its gain about half the year (R_RANK), a new page spends
// about half the year at target (R_NEW), and a new page reaches its target position with P_REACH.
const R_RANK = 0.5;
const R_NEW = 0.5;
const P_REACH = 0.1; // research default for keywords of unknown or above-median difficulty
// Seer (April 2026): clicks per impression with an AI Overview vs the pooled curve.
const AIO_FACTOR = { cited: 0.62, uncited: 0.28 };

function buildCandidates({ striking, decay, decayDays, regulatory, tracked, pending, curve, aiVisibility }) {
  const aioState = new Map(
    (aiVisibility || []).filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), !r.aiOverview ? 'none' : r.citesUs ? 'cited' : 'uncited'])
  );
  const perMonth = (n, days) => (n * 30) / days;
  const at = (p) => curve[Math.max(1, Math.min(20, Math.round(p)))].ctr;
  const candidates: any[] = [];
  let n = 1;

  for (const s of [...striking.clickProblems, ...striking.rankingProblems]) {
    const imprMonth = perMonth(s.impressions, s.windowDays || 28);
    const ctr = s.ctr / 100;
    const snippet = s.position <= 10.5 && ctr < 0.7 * at(s.position);
    let tp12: any;
    let basis: any;
    if (snippet) {
      tp12 = imprMonth * (at(s.position) - ctr) * 11;
      basis = 'snippet problem: CTR below 70% of the site curve at this position';
    } else if (s.position <= 10.5) {
      const target = s.position < 3.5 ? 1 : 3;
      tp12 = imprMonth * Math.max(0, at(target) - at(s.position)) * 12 * R_RANK;
      basis = `ranking problem: gain from position ${Math.round(s.position)} to ${target}`;
    } else {
      tp12 = imprMonth * Math.max(0, at(3) - ctr) * 12 * R_RANK;
      basis = 'page-two ranking problem (estimated from impressions; SE Ranking volume would be better)';
    }
    candidates.push({
      id: `C${n++}`,
      keyword: s.query,
      action: 'refresh',
      targetUrl: s.page,
      source: snippet ? 'snippet problem (quick edit)' : s.position <= 10.5 ? 'striking distance, click problem' : 'striking distance, ranking problem',
      trafficPotential: Math.round(tp12),
      effortHint: snippet ? 1 : 2,
      confidenceHint: 1,
      basis,
      evidence: `position ${s.position}, ${s.impressions} impressions, CTR ${s.ctr}%`,
    });
  }
  for (const d of decay) {
    candidates.push({
      id: `C${n++}`,
      keyword: null,
      action: d.type === 'demand_decay' ? 'watch' : 'refresh',
      targetUrl: d.page,
      source: `decay: ${d.type.replace(/_/g, ' ')}`,
      trafficPotential: Math.max(0, Math.round(perMonth(d.clicksLost, decayDays) * 12 * R_RANK)),
      confidenceHint: d.positionNow <= 20 ? 1 : 0.7,
      basis: 'recover half the lost clicks for the year',
      evidence: `clicks ${d.clicksBefore} to ${d.clicksNow} (${d.clicksPct}%), position ${d.positionBefore} to ${d.positionNow}`,
    });
  }
  for (const r of regulatory.slice(0, 10)) {
    candidates.push({
      id: `C${n++}`,
      keyword: null,
      action: 'refresh',
      targetUrl: r.url,
      source: 'regulatory change: Income-tax Act 2025',
      regulatory: true,
      trafficPotential: Math.round(r.clicks28d * 12 * R_RANK),
      effortHint: r.clicks28d < 3 ? 1 : 2,
      confidenceHint: 0.7,
      basis: 'protects current clicks from an out-of-date page',
      evidence: `still says "${r.example}"; last modified ${r.lastModified}`,
    });
  }
  const ctr5 = at(5);
  for (const t of tracked) {
    const state = aioState.get(t.keyword.toLowerCase());
    const aio = state === 'cited' ? AIO_FACTOR.cited : state === 'uncited' ? AIO_FACTOR.uncited : 1;
    const isNew = t.route === 'new';
    const tp12 = t.volume ? t.volume * ctr5 * 12 * aio * (isNew ? P_REACH * R_NEW : R_RANK) : null;
    candidates.push({
      id: `C${n++}`,
      keyword: t.keyword,
      action: t.route,
      targetUrl: t.existingPage,
      source: 'SE Ranking tracked keyword',
      trafficPotential: tp12 === null ? null : Math.round(tp12),
      // Research rule: 1.0 when we already rank in the top 20, 0.7 for 21-50, otherwise the AI judges (0.4-0.7).
      confidenceHint: t.existingPosition && t.existingPosition <= 20 ? 1 : t.existingPosition && t.existingPosition <= 50 ? 0.7 : null,
      basis: isNew ? `new page: volume x CTR at #5 x 12 x reach ${P_REACH} x ${R_NEW}${state ? `, AI Overview ${state}` : ''}` : 'existing page moving to #5',
      evidence: `volume ${t.volume ?? 'unknown'}, SE Ranking position ${t.sePosition || 'not in top 100'}${state && state !== 'none' ? `, AI Overview (${state})` : ''}`,
    });
  }
  for (const p of pending) {
    candidates.push({ id: `C${n++}`, keyword: p.keyword, action: 'new', targetUrl: null, source: 'already in the blog pipeline', trafficPotential: null, evidence: p.notes || '' });
  }
  return candidates;
}

// Priority = (Traffic Potential x Business Value x Deadline Factor x Confidence) / Effort
function priorityScore({ trafficPotential, businessValue, deadlineFactor, confidence, effort }) {
  const tp = Number(trafficPotential) || 0;
  const bv = Math.max(0, Math.min(3, Number(businessValue) || 0));
  const df = Number(deadlineFactor) || 1;
  const conf = Math.max(0.1, Math.min(1, Number(confidence) || 0.5));
  const eff = Math.max(1, Number(effort) || 3);
  return round((tp * bv * df * conf) / eff, 1);
}

// onStep(label, fraction 0-1) reports progress; the AI Overview checks are the slow part.
async function gatherStrategyAnalysis({ onStep }: any = {}) {
  const ranges = reliableRanges(90);
  const last28 = gsc().comparisonRanges(28);
  const q = gsc().querySearchAnalytics;
  const analysis = { generatedAt: new Date().toISOString(), windows: { decay: ranges, month: last28 }, errors: {} };

  // Steps run partly in parallel, so progress only ever moves forward.
  let reached = 0;
  const step = (label, fraction) => {
    reached = Math.max(reached, fraction);
    onStep?.(label, reached);
  };
  const safe = async (name, fn) => {
    step(STEP_LABELS[name] || name, STEP_AT[name] ?? 0);
    try {
      analysis[name] = await fn();
    } catch (e: any) {
      analysis.errors[name] = e.message;
    }
  };

  analysis.dataHygiene = eventsAffecting(last28, ranges);
  analysis.deadlines = upcomingDeadlines(new Date(), 150);

  let queryPage28: any[] = [];
  let queries28: any[] = [];
  let pages28: any[] = [];
  let queryPageLong: any[] = [];
  await safe('searchConsoleBase', async () => {
    [queryPage28, queries28, pages28, queryPageLong] = await Promise.all([
      q({ ...last28.current, dimensions: ['query', 'page'], rowLimit: 5000 }),
      q({ ...last28.current, dimensions: ['query'], rowLimit: 5000 }),
      q({ ...last28.current, dimensions: ['page'], rowLimit: 1000 }),
      q({ ...ranges.current, dimensions: ['query', 'page'], rowLimit: 5000 }),
    ]);
    return { queryPageRows: queryPage28.length, queryRows: queries28.length, pageRows: pages28.length };
  });

  const curve = ctrCurve(queries28.filter((r) => !isBranded(r.keys[0])));
  analysis.ctrCurve = Object.fromEntries(Object.entries(curve).slice(0, 10).map(([p, v]) => [p, { ctr: round(v.ctr * 100, 2), source: v.source }]));

  let tracked: any[] = [];
  await safe('trackedKeywords', async () => {
    const sites = await listSites();
    tracked = sites.length ? await getSiteRankings(sites[0].id) : [];
    return trackedKeywordRouting(tracked, queryPageLong);
  });

  // Priority keywords for the AI Overview check: tracked keywords with the most volume, plus the
  // top non-branded queries by impressions.
  const topQueries = queries28
    .filter((r) => !isBranded(r.keys[0]))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4)
    .map((r) => r.keys[0]);
  const trackedTop = [...tracked].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 6).map((t) => t.keyword);
  const geoKeywords = [...new Set([...trackedTop, ...topQueries].map((k) => k.trim()).filter(Boolean))].slice(0, 10);
  let checked = 0;
  // The live Google checks are the slow part, so they run while the rest of the analysis continues.
  const aiCheck = safe('aiVisibility', () =>
    aiOverviewVisibility(geoKeywords, () => {
      checked++;
      step(`Checking Google AI Overviews: ${checked} of ${geoKeywords.length} keywords`, 0.25 + 0.75 * (checked / geoKeywords.length));
    })
  );

  await safe('scoreboard', () => marketScoreboard(last28));
  analysis.strikingDistance = strikingDistance(queryPageLong, curve, ranges.days);
  await safe('decay', async () => {
    const [cur, prev] = await Promise.all([
      q({ ...ranges.current, dimensions: ['page'], rowLimit: 1000 }),
      q({ ...ranges.previous, dimensions: ['page'], rowLimit: 1000 }),
    ]);
    return decayTypes(cur, prev);
  });
  analysis.cannibalization = cannibalization(queryPageLong);
  await safe('cohorts', () => cohorts(pages28));
  await safe('regulatoryRefresh', () => regulatoryRefresh(pages28));
  await safe('aiReferrals', async () => {
    const [now, before] = await Promise.all([
      getAiReferrals(last28.current.startDate, last28.current.endDate),
      getAiReferrals(last28.previous.startDate, last28.previous.endDate),
    ]);
    return { now, before: { sessions: before.sessions, conversions: before.conversions, bySource: before.bySource }, changePct: pct(now.sessions, before.sessions) };
  });
  await aiCheck;
  analysis.questionBank = await questionBankMod.summary(30);

  if (analysis.aiVisibility) {
    const ok = analysis.aiVisibility.filter((r) => !r.error);
    analysis.aiVisibilitySummary = {
      checked: ok.length,
      withAiOverview: ok.filter((r) => r.aiOverview).length,
      citingUs: ok.filter((r) => r.citesUs).length,
      rankingTop10: ok.filter((r) => r.organicPosition && r.organicPosition <= 10).length,
    };
    const competitorCounts: any = {};
    for (const r of ok) for (const h of r.topCompetitors) if (h && !h.endsWith(SITE_HOST)) competitorCounts[h] = (competitorCounts[h] || 0) + 1;
    analysis.searchCompetitors = Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, top5Appearances]) => ({ domain, top5Appearances }));
  }

  const pending = await prisma.keywords.findMany({ where: { status: 'pending' }, select: { keyword: true, notes: true }, orderBy: { id: 'asc' }, take: 15 });
  analysis.candidates = buildCandidates({
    striking: analysis.strikingDistance,
    decay: analysis.decay || [],
    decayDays: ranges.days,
    regulatory: analysis.regulatoryRefresh || [],
    tracked: analysis.trackedKeywords || [],
    pending,
    curve,
    aiVisibility: analysis.aiVisibility,
  });

  return analysis;
}

export { gatherStrategyAnalysis, buildCandidates, priorityScore, ctrCurve, decayTypes, cannibalization, strikingDistance, reliableRanges, BRAND_REGEX };

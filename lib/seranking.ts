const BASE_URL = 'https://api.seranking.com/v1';

function getApiKey() {
  const key = process.env.SERANKING_API_KEY;
  if (!key) throw new Error('SERANKING_API_KEY is not set in .env');
  return key;
}

// SE Ranking allows 1 request per second per key. Every call goes through this queue so requests are
// spaced out (even when several run at once), and a 429 is retried once after a short wait.
const MIN_GAP_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttledFetch(url: string, init: any = {}): Promise<Response> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      // Every SE Ranking call gives up after 60 seconds, so a call that never answers cannot hang
      // the strategy (a caller's own abort signal still applies).
      const timeout = AbortSignal.timeout(60000);
      const res = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      if (res.status !== 429 || attempt >= 2) return res;
      await sleep(1500 * (attempt + 1));
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function get(path, { signal }: any = {}) {
  const res = await throttledFetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Token ${getApiKey()}` },
    signal,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`SE Ranking API error (${res.status}): ${json.error_description || JSON.stringify(json)}`);
  }
  return json;
}

async function getSubscription() {
  const json = await get('/account/subscription');
  return json.subscription_info;
}

async function listSites({ signal }: any = {}) {
  return get('/project-management/sites', { signal });
}

// Today's rank for every tracked keyword on a site, flattened and sorted by position. A project
// that tracks more than one search engine (for example Google US and Google India) returns each
// keyword once per engine; engineId tells those rows apart.
async function getSiteRankings(siteId, { signal }: any = {}) {
  const json = await get(`/project-management/sites/positions?site_id=${siteId}`, { signal });
  const rows: any[] = [];

  for (const engine of json) {
    for (const kw of engine.keywords || []) {
      const positions = kw.positions || [];
      const latest = positions[positions.length - 1];
      const previous = positions.length > 1 ? positions[positions.length - 2] : null;
      rows.push({
        keyword: kw.name,
        engineId: engine.site_engine_id ?? engine.id ?? null,
        position: latest ? latest.pos : null,
        change: latest ? latest.change : null,
        volume: kw.volume,
        date: latest ? latest.date : null,
        previousPosition: previous ? previous.pos : null,
      });
    }
  }

  // Unranked (pos 0, meaning not found in top 100) sort last; otherwise best position first.
  rows.sort((a, b) => {
    const posA = a.position === 0 ? Infinity : a.position;
    const posB = b.position === 0 ? Infinity : b.position;
    return posA - posB;
  });

  return rows;
}

async function researchKeywords(type, seed, { source = 'us', limit = 30 }: any = {}) {
  const validTypes = ['similar', 'related', 'questions', 'longtail'];
  if (!validTypes.includes(type)) throw new Error(`Invalid research type: ${type}`);

  const url = new URL(`${BASE_URL}/keywords/${type}`);
  url.searchParams.set('source', source);
  url.searchParams.set('keyword', seed);
  url.searchParams.set('limit', String(limit));

  const res = await throttledFetch(url.toString(), {
    headers: { Authorization: `Token ${getApiKey()}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`SE Ranking API error (${res.status}): ${json.error_description || JSON.stringify(json)}`);
  }
  return json.keywords || [];
}

// ---------- Backlinks (SE Ranking Data API). Replaces any competitor / backlink research that
// used to be planned for other tools: SE Ranking is the only backlink source. ----------

// Total referring domains pointing at a domain.
async function getReferringDomainsCount(domain: string) {
  const json: any = await get(`/backlinks/summary?target=${encodeURIComponent(domain)}&mode=domain`);
  const s = Array.isArray(json?.summary) ? json.summary[0] : json?.summary || json;
  const n = s?.refdomains ?? s?.referring_domains ?? null;
  if (typeof n !== 'number') throw new Error('SE Ranking returned no referring-domain count');
  return n;
}

async function listReferringDomains(domain: string, limit = 300) {
  const json: any = await get(`/backlinks/refdomains?target=${encodeURIComponent(domain)}&mode=domain&limit=${limit}`);
  const rows = json?.refdomains || json?.data || json || [];
  return (Array.isArray(rows) ? rows : []).map((r: any) => String(r.refdomain || r.domain || '').toLowerCase()).filter(Boolean);
}

// Sites that link to two or more competitors but not to us: the outreach list for the backlink plan.
async function getBacklinkGap(ourDomain: string, competitors: string[], limit = 40) {
  const ours = new Set(await listReferringDomains(ourDomain));
  const counts = new Map<string, string[]>();
  for (const c of competitors.slice(0, 5)) {
    for (const d of await listReferringDomains(c)) {
      if (ours.has(d)) continue;
      counts.set(d, [...(counts.get(d) || []), c]);
    }
  }
  return [...counts.entries()]
    .map(([domain, linksTo]) => ({ domain, linksTo }))
    .sort((a, b) => b.linksTo.length - a.linksTo.length)
    .slice(0, limit);
}

// Adds a keyword to rank tracking in the first SE Ranking project (after a blog is published).
async function addTrackedKeyword(keyword: string) {
  const sites: any = await listSites();
  if (!sites?.length) throw new Error('No SE Ranking project found');
  const res = await throttledFetch(`${BASE_URL}/project-management/sites/${sites[0].id}/keywords`, {
    method: 'POST',
    headers: { Authorization: `Token ${getApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: [{ keyword }] }),
  });
  if (!res.ok) throw new Error(`SE Ranking add keyword failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return true;
}

// Adds many keywords to rank tracking in the first project, 50 per request.
async function addTrackedKeywords(keywords: string[]) {
  const sites: any = await listSites();
  if (!sites?.length) throw new Error('No SE Ranking project found');
  let added = 0;
  for (let i = 0; i < keywords.length; i += 50) {
    const batch = keywords.slice(i, i + 50);
    const res = await throttledFetch(`${BASE_URL}/project-management/sites/${sites[0].id}/keywords`, {
      method: 'POST',
      headers: { Authorization: `Token ${getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: batch.map((keyword) => ({ keyword })) }),
    });
    if (!res.ok) throw new Error(`SE Ranking add keywords failed after ${added} (${res.status}): ${(await res.text()).slice(0, 200)}`);
    added += batch.length;
  }
  return added;
}

// ---------- AI visibility (GEO / AEO). Paths and fields follow SE Ranking's own n8n integration
// (github.com/seranking/n8n-nodes-seranking). ----------

export const AI_ENGINES = ['chatgpt', 'perplexity', 'gemini', 'ai-overview', 'ai-mode'] as const;

// Data API "AI Search": a domain's presence in one engine's answers, refreshed monthly by SE Ranking.
// summary.link_presence / average_position / ai_opportunity_traffic each carry current and previous.
async function getAiSearchOverview(domain: string, engine: string, source = 'us') {
  const q = new URLSearchParams({ target: domain, engine, source, scope: 'base_domain' });
  const json: any = await get(`/ai-search/overview/by-engine/time-series?${q}`);
  const s = json?.summary || {};
  const num = (v: any) => (typeof v === 'number' ? v : v === undefined || v === null || v === '' ? null : Number(v));
  return {
    engine,
    source,
    linkPresence: { current: num(s.link_presence?.current), previous: num(s.link_presence?.previous) },
    averagePosition: { current: num(s.average_position?.current), previous: num(s.average_position?.previous) },
    aiTraffic: { current: num(s.ai_opportunity_traffic?.current), previous: num(s.ai_opportunity_traffic?.previous) },
    raw: json,
  };
}

// Project API "AI Results Tracker": the prompts tracked in the SE Ranking project.
async function listAiTrackerEngines(siteId: number) {
  const json: any = await get(`/project-management/airt/llm?site_id=${siteId}`);
  return Array.isArray(json) ? json : json?.items || json?.data || [];
}

async function getAiTrackerStatistics(siteId: number, llmId: number, from?: string, to?: string) {
  const q = new URLSearchParams({ site_id: String(siteId), llm_id: String(llmId) });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return get(`/project-management/airt/llm/statistics?${q}`);
}

// Per-group time series with mention_presence and link_presence as percentages.
async function getAiTrackerPresence(siteId: number, llmId: number, dateFrom: string, dateTo: string) {
  const q = new URLSearchParams({ site_id: String(siteId), llm_id: String(llmId), date_from: dateFrom, date_to: dateTo, mode: 'groups' });
  return get(`/project-management/airt/prompts/rankings?${q}`);
}

export {
  getSubscription, listSites, getSiteRankings, researchKeywords, getReferringDomainsCount, listReferringDomains, getBacklinkGap, addTrackedKeyword, addTrackedKeywords,
  getAiSearchOverview, listAiTrackerEngines, getAiTrackerStatistics, getAiTrackerPresence,
};

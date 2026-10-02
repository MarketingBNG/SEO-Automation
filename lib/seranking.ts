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
      const res = await fetch(url, init);
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

export { getSubscription, listSites, getSiteRankings, researchKeywords };

function getKey() {
  const key = process.env.SERPHOUSE_API_KEY;
  if (!key) throw new Error('SERPHOUSE_API_KEY is not set in .env');
  return key;
}

// Live Google SERP lookup for one keyword. Used for ad-hoc "where do we rank for X right now"
// checks - separate from SE Ranking's daily tracked list, no extra units consumed there.
async function liveSearch({ q, domain = 'google.com', lang = 'en', device = 'desktop', loc = 'India', timeoutMs = 60000 }) {
  const res = await fetch('https://api.serphouse.com/serp/live', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { q, domain, lang, device, loc, serp_type: 'web' } }),
    // The live endpoint sometimes takes minutes and then returns nothing; don't let it hang callers.
    signal: AbortSignal.timeout(timeoutMs),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`SERPHouse API error (${res.status}): ${JSON.stringify(json)}`);
  }
  if (!json.results?.results) {
    throw new Error(`SERPHouse returned no results (${json.msg || json.status || 'unknown status'})`);
  }
  return json;
}

// Runs a live search and finds our own site's position in the organic results, if present.
async function checkRanking(keyword, siteDomain) {
  const json = await liveSearch({ q: keyword });
  const organic =
    json.results?.results?.organic ||
    json.results?.organic ||
    json.organic_results ||
    [];

  const host = siteDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const match = organic.find((r) => (r.url || r.link || '').includes(host));

  return {
    keyword,
    position: match ? match.position || organic.indexOf(match) + 1 : null,
    url: match ? match.url || match.link : null,
    title: match ? match.title : null,
    totalResults: organic.length,
  };
}

// Fast "is the API key valid?" check against the account endpoint.
async function accountInfo() {
  const res = await fetch('https://api.serphouse.com/account/info', {
    headers: { Authorization: `Bearer ${getKey()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('SERPHouse rejected the API key. Check SERPHOUSE_API_KEY.');
  if (!res.ok) throw new Error(`SERPHouse API error (${res.status}): ${json.msg || JSON.stringify(json).slice(0, 200)}`);
  return json.results || json;
}

export { liveSearch, checkRanking, accountInfo };

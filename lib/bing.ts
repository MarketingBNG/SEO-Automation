// Bing Webmaster Tools (K11): submits new URLs and checks the connection. Needs
// BING_WEBMASTER_API_KEY (Bing Webmaster Tools > Settings > API access) in the environment.
const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';
const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '') + '/';

function key() {
  const k = process.env.BING_WEBMASTER_API_KEY;
  if (!k) throw new Error('BING_WEBMASTER_API_KEY is not set');
  return k;
}

async function call(method: string, body?: any) {
  const res = await fetch(`${BASE}/${method}?apikey=${encodeURIComponent(key())}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing Webmaster error (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

export async function submitToBing(urls: string[]) {
  await call('SubmitUrlBatch', { siteUrl: SITE(), urlList: urls });
  return `${urls.length} URL(s) submitted`;
}

// Lists the verified sites on the account and confirms ours is one of them.
export async function testBing() {
  const json: any = await call('GetUserSites');
  const sites = (json.d || []).map((s: any) => String(s.Url || '').replace(/\/+$/, '/'));
  const ours = sites.find((u: string) => u.replace(/^https?:\/\/(www\.)?/, '') === SITE().replace(/^https?:\/\/(www\.)?/, ''));
  if (!ours) throw new Error(`Connected, but ${SITE()} is not a verified site on this Bing account (found: ${sites.join(', ') || 'none'})`);
  return { site: ours, verified: true };
}

// Without an API key here, Bing may still get every new post from WordPress itself: Microsoft's
// "Bing URL Submissions" plugin, an IndexNow plugin, or IndexNow in Rank Math or Yoast. Lists the
// active plugins (needs the WordPress user to be allowed to see plugins).
const BING_PLUGINS: { test: RegExp; name: string }[] = [
  { test: /bing-webmaster-tools|bing-url-submission/i, name: 'Bing URL Submissions (Microsoft)' },
  { test: /indexnow/i, name: 'IndexNow' },
  { test: /seo-by-rank-math|rank-math/i, name: 'Rank Math (IndexNow, if it is turned on under Instant Indexing)' },
  { test: /wordpress-seo|yoast/i, name: 'Yoast SEO (IndexNow, if it is turned on)' },
];

export async function bingViaWordPress(): Promise<{ plugins: string[] } | { error: string }> {
  const { wpRequest } = await import('./wordpress');
  const res: any = await wpRequest('GET', '/wp/v2/plugins', { query: { status: 'active', _fields: 'plugin,name' } }).catch((e: any) => ({ error: e.message }));
  if (res?.error) return { error: res.error };
  const list: any[] = Array.isArray(res?.json) ? res.json : [];
  const plugins = BING_PLUGINS.filter((p) => list.some((x) => p.test.test(`${x.plugin} ${x.name}`))).map((p) => p.name);
  return { plugins };
}

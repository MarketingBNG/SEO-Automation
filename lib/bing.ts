// Bing Webmaster Tools (K11): submits new URLs and checks the connection. Needs
// BING_WEBMASTER_API_KEY (Bing Webmaster Tools > Settings > API access) in the environment.
import { siteOrigin } from './siteConnector';

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';
const SITE = () => {
  const site = siteOrigin();
  if (!site) throw new Error('SITE_URL is not set (and the website connection is not set up)');
  return site + '/';
};

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

// Bing matches siteUrl to the verified site exactly, so the address sent is the verified one on the
// account (www or not, as Bing has it), found the same way testBing finds it and kept per process.
const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
const verified: { site?: string; url?: string } = {};

async function verifiedSites(): Promise<string[]> {
  const json: any = await call('GetUserSites');
  return (json.d || []).map((s: any) => String(s.Url || '').replace(/\/+$/, '/'));
}

async function siteUrl() {
  const site = SITE();
  if (verified.site === site && verified.url) return verified.url;
  // A lookup that fails does not stop the submission: it goes out with our own address.
  const ours = (await verifiedSites().catch(() => [] as string[])).find((u) => bare(u) === bare(site));
  if (!ours) return site;
  verified.site = site;
  verified.url = ours.endsWith('/') ? ours : ours + '/';
  return verified.url;
}

export async function submitToBing(urls: string[]) {
  await call('SubmitUrlBatch', { siteUrl: await siteUrl(), urlList: urls });
  return `${urls.length} URL(s) submitted`;
}

// Lists the verified sites on the account and confirms ours is one of them.
export async function testBing() {
  const sites = await verifiedSites();
  const ours = sites.find((u: string) => bare(u) === bare(SITE()));
  if (!ours) throw new Error(`Connected, but ${SITE()} is not a verified site on this Bing account (found: ${sites.join(', ') || 'none'})`);
  return { site: ours, verified: true };
}

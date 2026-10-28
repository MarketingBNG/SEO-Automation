// Fetches a page a person typed in (for example "Check a blog" by URL) without letting the server be
// used to read its own network: only http(s), only public addresses (no localhost, private, link-local
// or cloud metadata ranges), each redirect checked again, and the body capped in size.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && [0, 2].includes(Number(ip.split('.')[2]))) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('::ffff:') || s.startsWith('64:ff9b:');
  }
  return true;
}

// Throws (status 400) when the URL may not be fetched.
export async function assertPublicUrl(raw: string): Promise<URL> {
  const bad = (why: string) => Object.assign(new Error(`That URL cannot be fetched: ${why}.`), { status: 400 });
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw bad('it is not a valid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad('only http and https pages can be checked');
  if (url.username || url.password) throw bad('it contains a user name or password');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw bad('it points to a private or internal address');
    return url;
  }
  if (!host.includes('.') || /(^|\.)localhost$/i.test(host) || /\.(local|internal|lan|home)$/i.test(host)) throw bad('it is not a public website');
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw bad('the website name could not be found');
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw bad('it points to a private or internal address');
  return url;
}

// Returns { ok, status, text } like the parts of fetch the callers use.
export async function safeFetchText(raw: string, { timeoutMs = 20000 }: { timeoutMs?: number } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { signal, redirect: 'manual' });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (next) {
      if (hop >= MAX_REDIRECTS) throw Object.assign(new Error('That URL redirects too many times.'), { status: 400 });
      await res.body?.cancel().catch(() => {});
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, text: '' };
    }
    return { ok: true, status: res.status, text: await readCapped(res) };
  }
}

async function readCapped(res: Response) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error('That page is too large to check (over 5 MB).'), { status: 400 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

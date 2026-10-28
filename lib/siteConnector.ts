// The new custom website (usaindiacfo.com), reached through its dashboard connector
// (/_bridge/dashboard-connector.php, built by the site's developer from our README).
//
// Every request is signed: X-Dashboard-Timestamp (unix seconds) and
// X-Dashboard-Signature = HMAC-SHA256(SITE_CONNECTOR_SECRET, timestamp + "\n" + raw JSON body).
// Body: { action, data, nonce }. The site rejects anything unsigned, older than 5 minutes, or sent twice.
//
// Switched on by SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET (Coolify). While they are set, the
// WordPress helpers in lib/wordpress.ts send their work here instead of to WordPress.
import crypto from 'crypto';

export const connectorOn = () => Boolean(process.env.SITE_CONNECTOR_URL && process.env.SITE_CONNECTOR_SECRET);

// Values the site accepts (from the developer). Override with a comma-separated env value.
const list = (env: string | undefined, fallback: string[]) => (env ? env.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
export const SITE_CATEGORIES = () => list(process.env.SITE_CONNECTOR_CATEGORIES, ['advisory', 'business', 'case-study', 'compliance', 'incorporation', 'news', 'startup', 'tax', 'taxation']);
export const SITE_AUTHORS = () => list(process.env.SITE_CONNECTOR_AUTHORS, ['akshay-nahar', 'amit-agarwal', 'disha-vakharia', 'harsh-jain', 'naman-gangwal']);
// The site makes a post live as soon as it is saved. A draft is sent only once the developer has
// confirmed that "draft" stays hidden (SITE_CONNECTOR_DRAFTS=on).
export const draftsAllowed = () => process.env.SITE_CONNECTOR_DRAFTS === 'on';

// The live site's origin for checks that fetch it (robots.txt, Bing): WORDPRESS_SITE_URL, else the
// connector's own site when the connector is set up. '' when neither is (a local or test server,
// which must not fetch the live site).
export function siteOrigin(): string {
  const wp = (process.env.WORDPRESS_SITE_URL || '').trim().replace(/\/+$/, '');
  if (wp) return wp;
  if (!connectorOn()) return '';
  try {
    return new URL(String(process.env.SITE_CONNECTOR_URL)).origin;
  } catch {
    return '';
  }
}

export async function connectorCall(action: string, data: Record<string, unknown> = {}): Promise<any> {
  const url = process.env.SITE_CONNECTOR_URL;
  const secret = process.env.SITE_CONNECTOR_SECRET;
  if (!url || !secret) throw new Error('The website connector is not set up (SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET in Coolify).');
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    // The site accepts each signed request once: a random nonce makes every request (and every
    // retry) unique, even two identical ones in the same second.
    const body = JSON.stringify({ action, data, nonce: crypto.randomBytes(12).toString('hex') });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', secret).update(`${ts}\n${body}`).digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Timestamp': ts, 'X-Dashboard-Signature': sig },
        body,
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      if (res.ok && json?.ok) return json;
      const message = json?.error || String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200);
      const err: any = new Error(`Website ${action} failed (${res.status}): ${message}`);
      err.status = res.status;
      // Only a dropped connection or a server error is worth a second try.
      if (res.status < 500) throw err;
      lastErr = err;
    } catch (e: any) {
      if (e?.status && e.status < 500) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr;
}

// ---------- Posts ----------

export type SitePost = { id: number | null; slug: string; title: string; excerpt: string; content: string; status: string; category?: string; seo_title?: string | null; seo_description?: string | null; focus_keyphrase?: string | null; featured_image?: string | null; featured_image_alt?: string | null; published_at?: string; updated_at?: string; url: string };

const SITE = () => new URL(process.env.SITE_CONNECTOR_URL || 'https://usaindiacfo.com').origin;
const absolute = (u: string | null | undefined, slug: string) => (u ? (/^https?:\/\//.test(u) ? u : `${SITE()}${u.startsWith('/') ? '' : '/'}${u}`) : `${SITE()}/insights/${slug}/`);
export const slugFromUrl = (u: string) => {
  try {
    return new URL(u, SITE()).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return String(u || '').split('/').filter(Boolean).pop() || '';
  }
};

function norm(p: any): SitePost {
  return { ...p, id: p?.id != null && /^\d+$/.test(String(p.id)) ? Number(p.id) : null, url: absolute(p?.url, p?.slug) };
}

let listCache: { at: number; posts: SitePost[] } | null = null;
export async function sitePosts(fresh = false): Promise<SitePost[]> {
  if (!fresh && listCache && Date.now() - listCache.at < 60000) return listCache.posts;
  const json = await connectorCall('post.list');
  const posts = (json.posts || []).map(norm);
  listCache = { at: Date.now(), posts };
  return posts;
}

export async function sitePost(slug: string): Promise<SitePost | null> {
  if (!slug) return null;
  try {
    return norm((await connectorCall('post.get', { slug })).post);
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

// The dashboard keeps numeric post ids (wp_post_id). Ids saved in the WordPress days are still in the
// database and are small numbers like the site's own, so one could point at an unrelated post on the
// new site. The site's ids are therefore handed to the dashboard moved up by ID_OFFSET: an old
// WordPress id is never mistaken for a site post (it reads as "not on the website").
const ID_OFFSET = 1_000_000_000;
export const toDashId = (siteId: number | null) => (siteId == null ? null : ID_OFFSET + siteId);

// The site works by slug: the slug of a dashboard id (or a slug given directly).
export async function slugForId(id: number | string): Promise<string> {
  if (typeof id === 'string' && !/^\d+$/.test(id)) return id;
  const n = Number(id);
  if (!(n > ID_OFFSET)) throw Object.assign(new Error(`Post #${id} is from the old WordPress site, not the new website.`), { status: 404 });
  const siteId = n - ID_OFFSET;
  const hit = (await sitePosts()).find((p) => p.id === siteId) || (await sitePosts(true)).find((p) => p.id === siteId);
  if (!hit) throw Object.assign(new Error(`Post #${id} is not on the website.`), { status: 404 });
  return hit.slug;
}

export const isLive = (status: string | undefined) => /^(publish|published|live)$/i.test(String(status || ''));

// One of the site's categories for a blog, from its keyword and title. Default: tax.
export function pickCategory(text: string): string {
  const t = String(text || '').toLowerCase();
  const allowed = SITE_CATEGORIES();
  const rules: [RegExp, string][] = [
    [/\b(incorporat|llc|c-?corp|delaware|register(ing)? a company|ein\b|form a company|entity formation)/, 'incorporation'],
    [/\b(fbar|fatca|fema|compliance|filing|form \d|5472|due date|deadline|penalt|roc|annual return|boi)\b/, 'compliance'],
    [/\b(startup|founder|funding|valuation|esop|investor|saas|flip)\b/, 'startup'],
    [/\b(cfo|advisory|virtual cfo|fractional|accounting|bookkeeping|audit)\b/, 'advisory'],
    [/\b(bank account|business|expansion|subsidiary|payroll|invoice)\b/, 'business'],
    [/\b(tax|tds|tcs|itr|gst|nri|dtaa|capital gain|irs|1040|withholding)\b/, 'tax'],
  ];
  for (const [re, cat] of rules) if (re.test(t) && allowed.includes(cat)) return cat;
  return allowed.includes('tax') ? 'tax' : allowed[0];
}

// "Akshay Nahar, CA" -> "akshay-nahar", only when the site knows that author.
export function authorSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const slug = String(name).split(',')[0].trim().toLowerCase().replace(/[^a-z\s-]/g, '').trim().replace(/\s+/g, '-');
  return SITE_AUTHORS().includes(slug) ? slug : null;
}

export const siteStatus = (wpStatus?: string) => (wpStatus === 'draft' || wpStatus === 'pending' || wpStatus === 'private' ? 'draft' : 'published');

// ---------- Images ----------

const MIME_OK = /\.(jpe?g|png|webp)$/i;

export async function siteUpload(buffer: Buffer, filename: string): Promise<string> {
  if (!MIME_OK.test(filename)) throw new Error(`The website takes JPEG, PNG or WebP images only (${filename}).`);
  const json = await connectorCall('media.upload', { filename, base64: buffer.toString('base64') });
  if (!json.url) throw new Error('The website did not return the image address.');
  return absolute(json.url, '');
}

// A stable positive number for an uploaded image, so the image library can remember that an image
// is already on the site (it stores a numeric media id) and not upload it again.
export const mediaIdFor = (url: string) => (parseInt(crypto.createHash('sha1').update(url).digest('hex').slice(0, 7), 16) || 1);

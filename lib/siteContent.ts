// Content for the new custom website: pages (made of keyed sections) and blog posts, stored here
// and read by the website through /api/site/v1 with a read key. When something changes, the
// website is told through a signed webhook so it can refresh only that page.
import crypto from 'crypto';
import prisma from './prisma';

export type ContentRow = Awaited<ReturnType<typeof prisma.site_content.findFirst>> & {};

const j = (s: string | null | undefined, fallback: any) => {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// "/services/x/" -> "/services/x"; "home" or "" -> "/".
export function normalizeSlug(s: string) {
  let v = String(s || '').trim();
  if (/^https?:\/\//i.test(v)) v = new URL(v).pathname;
  v = '/' + v.replace(/^\/+|\/+$/g, '');
  return v === '/home' ? '/' : v;
}

export function toPage(r: ContentRow) {
  return { slug: r.slug, title: r.title, metaDescription: r.meta_description || '', canonical: r.canonical || '', ogImage: j(r.og_image, null), schema: j(r.schema, []), sections: j(r.sections, {}), updatedAt: r.updated_at };
}

export function toPost(r: ContentRow, full = true) {
  const base = { slug: r.slug, title: r.title, metaDescription: r.meta_description || '', cover: j(r.cover, null), author: j(r.author, null), categories: j(r.categories, []), tags: j(r.tags, []), publishedAt: r.published_at || r.created_at, updatedAt: r.updated_at };
  return full ? { ...base, canonical: r.canonical || '', html: r.html || '', schema: j(r.schema, []) } : base;
}

// Checks "Authorization: Bearer <key>" against a key from the environment, in constant time.
export function keyMatches(req: Request, envName: 'SITE_API_KEY' | 'SITE_IMPORT_KEY') {
  const want = process.env[envName];
  if (!want) return { ok: false, status: 503, error: `${envName} is not set on the dashboard` };
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Bad or missing key' };
  return { ok: true, status: 200, error: '' };
}

// Tells the website that a page or post changed. Signed with SITE_WEBHOOK_SECRET (HMAC-SHA256 of
// the raw body in X-Signature). Retries twice; never throws.
export async function notifyWebsite(event: string, type: string, slug: string) {
  const url = process.env.SITE_WEBHOOK_URL;
  const secret = process.env.SITE_WEBHOOK_SECRET;
  if (!url || !secret) return { sent: false, reason: 'SITE_WEBHOOK_URL or SITE_WEBHOOK_SECRET not set' };
  const body = JSON.stringify({ event, type, slug, updatedAt: new Date().toISOString() });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig }, body, signal: AbortSignal.timeout(10000) });
      if (res.ok) return { sent: true };
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return { sent: false, reason: 'The website did not answer' };
}

const str = (v: any) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// Creates or updates one page or post from the API shape (used by import and by the editor).
export async function upsertContent(type: 'page' | 'post', item: any, actor?: string | null) {
  const slug = normalizeSlug(item.slug);
  if (!item.title) throw Object.assign(new Error(`Missing title for ${slug}`), { status: 400 });
  const data = {
    type,
    slug,
    title: String(item.title).slice(0, 300),
    meta_description: item.metaDescription ?? null,
    canonical: item.canonical ?? null,
    og_image: str(item.ogImage),
    schema: str(item.schema),
    sections: type === 'page' ? str(item.sections || {}) : null,
    html: type === 'post' ? String(item.html || '') : null,
    cover: str(item.cover),
    author: str(item.author),
    categories: str(item.categories),
    tags: str(item.tags),
    status: item.status === 'draft' ? 'draft' : 'published',
    published_at: item.publishedAt || (type === 'post' ? new Date().toISOString() : null),
    updated_by: actor || null,
    updated_at: new Date().toISOString(),
  };
  const before = await prisma.site_content.findUnique({ where: { slug } });
  const row = await prisma.site_content.upsert({ where: { slug }, create: data, update: data });
  return { row, created: !before };
}

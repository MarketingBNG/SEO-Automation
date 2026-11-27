// The company website, reached only through its dashboard connector (lib/siteConnector.ts).
// Publishing, updates, images, post lists and post reads all go through here. While
// SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET are not set, every call fails with one clear message
// (SITE_NOT_SET_UP): nothing is published anywhere else.
import crypto from 'crypto';
import { readFile, basename } from './storage';
import {
  connectorOn,
  connectorCall,
  sitePost,
  sitePosts,
  slugForId,
  toDashId,
  slugFromUrl,
  isLive,
  pickCategory,
  authorSlug,
  siteStatus,
  siteUpload,
  mediaIdFor,
  draftsAllowed,
  SiteNotSetUpError,
  SITE_NOT_SET_UP,
  type SitePost,
} from './siteConnector';

export { SITE_NOT_SET_UP, SiteNotSetUpError, draftsAllowed };

// A post as the dashboard uses it. id is the dashboard id (the site's id moved up, see toDashId).
export type Post = {
  id: number | null;
  slug: string;
  status: 'publish' | 'draft';
  link: string;
  date: string | null;
  modified: string | null;
  title: string;
  content: string;
  excerpt: string;
  category: string | null;
  author: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  focusKeyphrase: string | null;
  featuredImage: string | null;
  featuredImageAlt: string | null;
};

const toPost = (p: SitePost & Record<string, any>): Post => ({
  id: toDashId(p.id),
  slug: p.slug,
  status: isLive(p.status) ? 'publish' : 'draft',
  link: p.url,
  date: p.published_at || null,
  modified: p.updated_at || p.published_at || null,
  title: p.title || '',
  content: p.content || '',
  excerpt: p.excerpt || '',
  category: p.category || null,
  author: p.author || null,
  seoTitle: p.seo_title ?? null,
  seoDescription: p.seo_description ?? null,
  focusKeyphrase: p.focus_keyphrase ?? null,
  featuredImage: p.featured_image ?? null,
  featuredImageAlt: p.featured_image_alt ?? null,
});

// The fields an update can set, as the post holds them now (for undo: what a fix wrote).
const FIELD_OF: Record<string, (p: Post) => unknown> = { contentHtml: (p) => p.content, seoTitle: (p) => p.seoTitle, metaDescription: (p) => p.seoDescription, title: (p) => p.title, excerpt: (p) => p.excerpt, authorName: (p) => p.author, authorSlugRaw: (p) => p.author };
export function postFieldsHash(post: Post, keys: string[]): string {
  const vals = [...keys].sort().map((k) => [k, FIELD_OF[k] ? FIELD_OF[k](post) ?? null : null]);
  return crypto.createHash('sha1').update(JSON.stringify(vals)).digest('hex');
}

// Whether the website can be reached at all. Checked before steps that save anything, so a publish
// that cannot go out changes nothing.
export const siteConfigured = () => connectorOn();
function need() {
  if (!connectorOn()) throw new SiteNotSetUpError();
}

const noDrafts = () =>
  new Error('Sending a draft to the website is switched off: the website makes every saved post live at once. Approve the blog and publish it, or ask the developer to confirm drafts stay hidden (then set SITE_CONNECTOR_DRAFTS=on).');

// Why a post with this status cannot be sent (the website makes every saved post live, so a draft is
// refused until SITE_CONNECTOR_DRAFTS=on), or null. Checked before steps that save anything.
export function draftsRefused(status: string): string | null {
  return siteStatus(status) === 'draft' && !draftsAllowed() ? noDrafts().message : null;
}

// Settings > Website connection: the site answers a signed ping.
export async function testConnection() {
  need();
  const j = await connectorCall('ping');
  return { site: j.site || null, storage: j.storage || null, drafts: draftsAllowed() };
}

// Short, readable, keyword-based URL slug for NEW posts only (never change an existing post's slug:
// that changes its URL and loses rankings and links).
export function seoSlug(text: any) {
  const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'is', 'are', 'how', 'what']);
  const words = String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w));
  return (kept.length >= 2 ? kept : words).slice(0, 7).join('-');
}

// The website numbers its own "On this page" list, so a heading that starts with "1." or "2)" would
// show as "1. 1. ...". Those leading numbers are removed from H2 to H4 before a post is sent.
export function stripHeadingNumbers(html: string) {
  return String(html || '').replace(/(<h[2-4]\b[^>]*>)((?:\s|<[^>]+>)*)(?:step\s+)?\d{1,2}(?:\.\d{1,2})*\s*[.):-]\s+/gi, '$1$2');
}

// Uploads a stored image (storage key) to the website. id is a stable number for the image library.
export async function uploadImage(key: string, { altText }: { altText?: string | null; title?: string } = {}) {
  need();
  const bytes = await readFile(key);
  if (!bytes) throw new Error(`ENOENT: no such file or directory, open '${key}'`);
  const url = await siteUpload(bytes, basename(key));
  return { id: mediaIdFor(url), url, altText: altText || null };
}

// A free address: the site saves by slug, so a taken one would overwrite that post. A taken slug gets
// -2, -3...
async function freeSiteSlug(slug: string) {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    if (!(await sitePost(candidate))) return candidate;
  }
  throw new Error(`No free address found for /${slug}/ on the website.`);
}

export type PostFields = {
  title?: string;
  contentHtml?: string;
  excerpt?: string | null;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  status?: string;
  slug?: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  focusKeyphrase?: string | null;
  authorName?: string | null;
  category?: string;
  // Updates only: the site's author field exactly as given (a slug, or null to clear it), for undo.
  authorSlugRaw?: string | null;
  // Updates only: send the article exactly as given (live edits and their undo), without removing
  // heading numbers (stripHeadingNumbers), so only the asked change reaches the page.
  keepContent?: boolean;
};

export async function publishPost({ title = '', contentHtml = '', excerpt, featuredImageUrl, featuredImageAlt, status = 'publish', slug, seoTitle, metaDescription, focusKeyphrase, authorName, category }: PostFields): Promise<Post> {
  need();
  if (siteStatus(status) === 'draft' && !draftsAllowed()) throw noDrafts();
  const finalSlug = await freeSiteSlug(slug || seoSlug(title));
  await connectorCall('post.create', {
    slug: finalSlug,
    title,
    content: stripHeadingNumbers(contentHtml),
    excerpt: excerpt || '',
    status: siteStatus(status),
    category: category || pickCategory(`${focusKeyphrase || ''} ${title}`),
    ...(authorSlug(authorName) ? { author: authorSlug(authorName) } : {}),
    seo_title: seoTitle || title,
    ...(metaDescription ? { seo_description: metaDescription } : {}),
    ...(focusKeyphrase ? { focus_keyphrase: focusKeyphrase } : {}),
    ...(featuredImageUrl ? { featured_image: featuredImageUrl, featured_image_alt: featuredImageAlt || title } : {}),
  });
  const saved = await sitePost(finalSlug);
  if (!saved) throw new Error(`The website accepted the post but /${finalSlug}/ cannot be read back. Check it on the website before publishing again.`);
  return toPost(saved);
}

// Updates an EXISTING post in place. Its address never changes (that would lose its rankings).
export async function updatePost(postId: number | string, fields: PostFields): Promise<Post> {
  const { title, contentHtml, excerpt, featuredImageUrl, featuredImageAlt, status, seoTitle, metaDescription, focusKeyphrase, authorName, category, keepContent } = fields;
  need();
  const at = await slugForId(postId);
  const cur: any = await sitePost(at);
  if (!cur) throw Object.assign(new Error(`/${at}/ is not on the website.`), { status: 404 });
  const next = status ? siteStatus(status) : isLive(cur.status) ? 'published' : 'draft';
  if (next === 'draft' && !draftsAllowed()) throw noDrafts();
  // The site saves the whole post, so every field the change does not touch is sent as it is.
  await connectorCall('post.update', {
    slug: at,
    title: title || cur.title,
    content: contentHtml ? (keepContent ? contentHtml : stripHeadingNumbers(contentHtml)) : cur.content,
    excerpt: excerpt ?? cur.excerpt ?? '',
    status: next,
    category: category || cur.category || pickCategory(`${focusKeyphrase || ''} ${title || cur.title}`),
    ...('authorSlugRaw' in fields ? { author: fields.authorSlugRaw ?? null } : authorSlug(authorName) ? { author: authorSlug(authorName) } : cur.author ? { author: cur.author } : {}),
    seo_title: seoTitle || cur.seo_title || title || cur.title,
    seo_description: metaDescription ?? cur.seo_description ?? null,
    focus_keyphrase: focusKeyphrase ?? cur.focus_keyphrase ?? null,
    featured_image: featuredImageUrl ?? cur.featured_image ?? null,
    featured_image_alt: featuredImageUrl ? featuredImageAlt || title || cur.title : cur.featured_image_alt ?? null,
  });
  return toPost((await sitePost(at)) || cur);
}

// Live posts, one page at a time (Refresh a live blog).
export async function listPosts({ perPage = 50, page = 1 } = {}) {
  need();
  const live = (await sitePosts(true)).filter((p) => isLive(p.status));
  const totalPages = Math.max(1, Math.ceil(live.length / perPage));
  return { posts: live.slice((page - 1) * perPage, page * perPage).map(toPost), totalPages, page };
}

// Every live post. full: with the article text (read one by one when the list leaves it out).
export async function livePosts({ full = false, fresh = false } = {}): Promise<Post[]> {
  need();
  const live = (await sitePosts(fresh)).filter((p) => isLive(p.status));
  if (!full) return live.map(toPost);
  const out: Post[] = [];
  // One post at a time with a short pause, so a full read of hundreds of posts stays under the
  // website's rate limit (it answers 429 when asked too fast).
  for (const p of live) {
    if (p.content) { out.push(toPost(p)); continue; }
    out.push(toPost((await sitePost(p.slug)) || p));
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

// Small words that say nothing about a post's topic.
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'when', 'your', 'you', 'are', 'from', 'into', 'about', 'can', 'does', 'this', 'that', 'its', 'our', 'all', 'new', 'not', 'who', 'which']);
const topicWords = (text: string) => [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)))];

// Live posts whose titles share the text's topic words, best first: each distinct word counts once,
// as a whole word, and a post needs at least two of them (all of them when the text has fewer).
// full: with the article text.
export async function searchPosts(text: string, limit = 10, { full: withText = true } = {}): Promise<Post[]> {
  need();
  const words = topicWords(text);
  if (!words.length) return [];
  const needed = Math.min(2, words.length);
  const hits = (await sitePosts())
    .filter((p) => isLive(p.status))
    .map((p) => {
      const title = new Set(topicWords(p.title));
      return { p, score: words.filter((w) => title.has(w)).length };
    })
    .filter((h) => h.score >= needed)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.p);
  if (!withText) return hits.map(toPost);
  const full = await Promise.all(hits.map((h) => (h.content ? h : sitePost(h.slug))));
  return full.filter((p): p is SitePost => Boolean(p)).map(toPost);
}

// One post by dashboard id. Throws (status 404) when it is not on the website.
export async function getPost(postId: number | string): Promise<Post> {
  need();
  const p = await sitePost(await slugForId(postId));
  if (!p) throw Object.assign(new Error(`Post #${postId} is not on the website.`), { status: 404 });
  return toPost(p);
}

// 'publish' or 'draft', or null when the post is not on the website (any other failure is thrown).
export async function postStatus(postId: number | string): Promise<'publish' | 'draft' | null> {
  try {
    return (await getPost(postId)).status;
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 410) return null;
    throw e;
  }
}

export async function postBySlug(slug: string): Promise<Post | null> {
  need();
  const p = slug ? await sitePost(slug) : null;
  return p ? toPost(p) : null;
}

// A post from its public address, so a person can paste a link.
export async function findPostByUrl(url: string): Promise<Post> {
  const p = await postBySlug(slugFromUrl(url));
  if (!p) throw new Error(`No post found matching "${url}"`);
  return p;
}

// Before a blog goes live at an address: a LIVE post already there is reported (and never touched),
// so the caller can say the address is taken; a new post then gets -2. Nothing is deleted on the website.
export async function freeSlug(slug: string, keepId?: number | null): Promise<{ liveHolder: { id: number; link: string } | null }> {
  if (!slug) return { liveHolder: null };
  const p = await postBySlug(slug);
  return { liveHolder: p && p.id !== keepId && p.status === 'publish' ? { id: p.id as number, link: p.link } : null };
}

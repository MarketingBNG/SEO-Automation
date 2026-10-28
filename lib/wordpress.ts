import path from 'path';
import { readFile, basename } from './storage';
import { connectorOn, connectorCall, sitePost, sitePosts, slugForId, toDashId, slugFromUrl, isLive, pickCategory, authorSlug, siteStatus, siteUpload, mediaIdFor, draftsAllowed } from './siteConnector';

// The new custom website replaced WordPress. While SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET are
// set (lib/siteConnector.ts), the helpers below do their work through the website's connector:
// same inputs and the same WordPress-shaped answers, so the code that calls them does not change.
// What the connector does not offer (pages, Yoast, users, plugins...) is refused with a clear error.

// Images uploaded in this process, by the numeric id handed back to the caller, so a post can use
// the image's address as its cover.
// A slow website must not hold the daily run for undici's 300 s default per call.
const WP_TIMEOUT_MS = 60000;
const WP_UPLOAD_TIMEOUT_MS = 120000;
const uploaded = new Map<number, { url: string; alt: string | null }>();
const coverOf = (featuredMediaId: any, featuredImageUrl?: string | null) =>
  featuredImageUrl ? { url: featuredImageUrl, alt: null } : featuredMediaId ? uploaded.get(Number(featuredMediaId)) || null : null;
const noDrafts = () => new Error('Sending a draft to the website is switched off: the website makes every saved post live at once. Approve the blog and publish it, or ask the developer to confirm drafts stay hidden (then set SITE_CONNECTOR_DRAFTS=on).');
const wpShape = (p: any) => ({ id: toDashId(p.id), slug: p.slug, status: isLive(p.status) ? 'publish' : 'draft', link: p.url, modified: p.updated_at, title: { raw: p.title, rendered: p.title }, content: { raw: p.content, rendered: p.content }, excerpt: { raw: p.excerpt, rendered: p.excerpt } });

// A free address: the site saves by slug, so a taken one would overwrite that post. Like WordPress,
// a taken slug gets -2, -3...
async function freeSiteSlug(slug: string) {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    if (!(await sitePost(candidate))) return candidate;
  }
  throw new Error(`No free address found for /${slug}/ on the website.`);
}

// Whether publishing can reach the website at all (the site connector, or the WordPress login).
// Checked before steps that save anything, so a publish that cannot go out changes nothing.
function wpConfigured() {
  if (connectorOn()) return true;
  return Boolean((process.env.WORDPRESS_SITE_URL || '').trim() && process.env.WORDPRESS_USERNAME && process.env.WORDPRESS_APPLICATION_PASSWORD);
}

function getConfig() {
  const siteUrl = (process.env.WORDPRESS_SITE_URL || '').replace(/\/+$/, '');
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APPLICATION_PASSWORD;
  if (!siteUrl || !username || !appPassword) {
    throw new Error(
      'WordPress connection is not configured. Set WORDPRESS_SITE_URL, WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD in .env'
    );
  }
  const authHeader = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  return { siteUrl, authHeader };
}

async function testConnection() {
  if (connectorOn()) {
    const j = await connectorCall('ping');
    return { name: 'Website connector', site: j.site || null, storage: j.storage || null, roles: [], capabilities: {} };
  }
  const { siteUrl, authHeader } = getConfig();
  // context=edit adds the user's roles and capabilities (used to show whether plugins can be installed).
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress connection failed (${res.status}): ${body}`);
  }
  return res.json();
}

// PORT NOTE: localFilePath is now the stored storage key (or legacy path); bytes come from blob storage.
async function uploadFeaturedImage(localFilePath) {
  if (connectorOn()) {
    const bytes = await readFile(localFilePath);
    if (!bytes) throw new Error(`ENOENT: no such file or directory, open '${localFilePath}'`);
    const url = await siteUpload(bytes, basename(localFilePath));
    const id = mediaIdFor(url);
    uploaded.set(id, { url, alt: null });
    return id;
  }
  const { siteUrl, authHeader } = getConfig();
  const fileBuffer = await readFile(localFilePath);
  // Same failure the old fs.readFileSync threw for a missing file.
  if (!fileBuffer) throw new Error(`ENOENT: no such file or directory, open '${localFilePath}'`);
  const filename = basename(localFilePath);
  const ext = path.extname(filename).toLowerCase();
  const mime =
    { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[
      ext
    ] || 'application/octet-stream';

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    signal: AbortSignal.timeout(WP_UPLOAD_TIMEOUT_MS),
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress media upload failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  return json.id;
}

// Uploads image bytes held in memory (for example an image re-compressed by the speed fixer).
async function uploadBuffer(buffer: Buffer, filename: string, mime: string) {
  if (connectorOn()) {
    const url = await siteUpload(buffer, filename);
    return { id: mediaIdFor(url), source_url: url, mime_type: mime };
  }
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    signal: AbortSignal.timeout(WP_UPLOAD_TIMEOUT_MS),
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"` },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) throw new Error(`WordPress media upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Yoast's own fields. WordPress silently ignores them until the one-time snippet in
// wordpress/yoast-rest-fields.php registers them for the REST API (see Settings > Yoast SEO fields).
function yoastMeta({ metaDescription, focusKeyphrase }) {
  const meta: any = {};
  if (metaDescription) meta._yoast_wpseo_metadesc = metaDescription;
  if (focusKeyphrase) meta._yoast_wpseo_focuskw = focusKeyphrase;
  return Object.keys(meta).length ? { meta } : {};
}

// The REST API saves the post before its meta, and Yoast rebuilds its cached SEO data (the
// "indexable" it prints in the page head) when the post is saved, so a meta-only change would not
// reach the page. Saving the post once more, unchanged, makes Yoast pick up the new values.
async function refreshYoast(type, id) {
  await wpRequest('POST', `/wp/v2/${type === 'page' ? 'pages' : 'posts'}/${id}`, { body: {} }).catch(() => {});
}

// Short, readable, keyword-based URL slug for NEW posts only (never change an existing post's slug:
// that changes its URL and loses rankings and links).
function seoSlug(text) {
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

async function publishPost({ title, contentHtml, excerpt, featuredMediaId, featuredImageUrl, featuredImageAlt, status = 'publish', slug, metaDescription, focusKeyphrase, author, authorName, category }: any) {
  if (connectorOn()) {
    if (siteStatus(status) === 'draft' && !draftsAllowed()) throw noDrafts();
    const finalSlug = await freeSiteSlug(slug || seoSlug(title));
    const cover = coverOf(featuredMediaId, featuredImageUrl);
    await connectorCall('post.create', {
      slug: finalSlug,
      title,
      content: contentHtml,
      excerpt: excerpt || '',
      status: siteStatus(status),
      category: category || pickCategory(`${focusKeyphrase || ''} ${title}`),
      ...(authorSlug(authorName) ? { author: authorSlug(authorName) } : {}),
      seo_title: title,
      ...(metaDescription ? { seo_description: metaDescription } : {}),
      ...(focusKeyphrase ? { focus_keyphrase: focusKeyphrase } : {}),
      ...(cover ? { featured_image: cover.url, featured_image_alt: featuredImageAlt || cover.alt || title } : {}),
    });
    const saved = await sitePost(finalSlug);
    if (!saved) throw new Error(`The website accepted the post but /${finalSlug}/ cannot be read back. Check it on the website before publishing again.`);
    return wpShape(saved);
  }
  const { siteUrl, authHeader } = getConfig();

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      content: contentHtml,
      excerpt: excerpt || '',
      status, // 'draft' or 'publish'
      ...(slug ? { slug } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      ...(author ? { author } : {}),
      ...yoastMeta({ metaDescription, focusKeyphrase }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress post publish failed (${res.status}): ${body}`);
  }
  const post = await res.json();
  if (metaDescription || focusKeyphrase) await refreshYoast('post', post.id);
  return post;
}

// Updates an EXISTING post in place - used when the human chooses "replace an existing post"
// instead of publishing a new one.
async function updatePost(postId, { title, contentHtml, excerpt, featuredMediaId, featuredImageUrl, featuredImageAlt, status, metaDescription, focusKeyphrase, slug, author, authorName, category }: any) {
  if (connectorOn()) {
    // The address of a post never changes (that would lose its rankings), so slug is ignored here.
    const at = await slugForId(postId);
    const cur: any = await sitePost(at);
    if (!cur) throw Object.assign(new Error(`/${at}/ is not on the website.`), { status: 404 });
    const next = status ? siteStatus(status) : isLive(cur.status) ? 'published' : 'draft';
    if (next === 'draft' && !draftsAllowed()) throw noDrafts();
    const cover = coverOf(featuredMediaId, featuredImageUrl);
    // The site saves the whole post, so every field the change does not touch is sent as it is.
    await connectorCall('post.update', {
      slug: at,
      title: title || cur.title,
      content: contentHtml || cur.content,
      excerpt: excerpt ?? cur.excerpt ?? '',
      status: next,
      category: category || cur.category || pickCategory(`${focusKeyphrase || ''} ${title || cur.title}`),
      ...(authorSlug(authorName) ? { author: authorSlug(authorName) } : cur.author ? { author: cur.author } : {}),
      seo_title: cur.seo_title || title || cur.title,
      seo_description: metaDescription ?? cur.seo_description ?? null,
      focus_keyphrase: focusKeyphrase ?? cur.focus_keyphrase ?? null,
      featured_image: cover?.url ?? cur.featured_image ?? null,
      featured_image_alt: cover ? featuredImageAlt || cover.alt || title || cur.title : cur.featured_image_alt ?? null,
    });
    return wpShape((await sitePost(at)) || cur);
  }
  const { siteUrl, authHeader } = getConfig();

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts/${postId}`, {
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    method: 'POST', // WP REST API uses POST for partial updates too
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(title ? { title } : {}),
      ...(contentHtml ? { content: contentHtml } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(status ? { status } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      ...(slug ? { slug } : {}),
      ...(author ? { author } : {}),
      ...yoastMeta({ metaDescription, focusKeyphrase }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress post update failed (${res.status}): ${body}`);
  }
  const post = await res.json();
  if (metaDescription || focusKeyphrase) await refreshYoast('post', postId);
  return post;
}

// Lists published posts (for the Blog Renewal queue) - id, title, link, excerpt, modified date.
async function listPosts({ perPage = 50, page = 1 }: any = {}) {
  if (connectorOn()) {
    const live = (await sitePosts(true)).filter((p) => isLive(p.status));
    const totalPages = Math.max(1, Math.ceil(live.length / perPage));
    const posts = live.slice((page - 1) * perPage, page * perPage).map((p) => ({ id: toDashId(p.id), title: { rendered: p.title }, link: p.url, excerpt: { rendered: p.excerpt || '' }, modified: p.updated_at }));
    return { posts, totalPages, page };
  }
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,title,link,excerpt,modified`,
    { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(WP_TIMEOUT_MS) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress list posts failed (${res.status}): ${body}`);
  }
  const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
  const posts = await res.json();
  return { posts, totalPages, page };
}

// Fetches one post's full content by ID - used to seed an audit/rewrite with the live content.
async function getPost(postId) {
  if (connectorOn()) {
    const p = await sitePost(await slugForId(postId));
    if (!p) throw Object.assign(new Error(`Post #${postId} is not on the website.`), { status: 404 });
    return wpShape(p);
  }
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content,excerpt`,
    { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(WP_TIMEOUT_MS) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress get post failed (${res.status}): ${body}`);
  }
  return res.json();
}

// General authenticated REST call for anything the specific helpers above don't cover (pages,
// menus, settings, plugins, revisions...). Throws with WordPress's own error message on failure.
async function wpRequest(method, route, { query, body }: any = {}) {
  if (connectorOn()) return siteRequest(String(method).toUpperCase(), String(route), query || {}, body);
  const { siteUrl, authHeader } = getConfig();
  const url = new URL(`${siteUrl}/wp-json${route}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }

  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    headers: {
      Authorization: authHeader,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const message = json && typeof json === 'object' && json.message ? json.message : String(text).slice(0, 300);
    const err: any = new Error(`WordPress ${method} ${route} failed (${res.status}): ${message}`);
    err.status = res.status;
    throw err;
  }
  return { json, headers: res.headers };
}

// Uploads a local image to the Media Library and sets its alt text / title / caption.
async function uploadMedia(localFilePath, { altText, title, caption }: any = {}) {
  if (connectorOn()) {
    const id = await uploadFeaturedImage(localFilePath);
    const img = uploaded.get(id)!;
    img.alt = altText || null;
    return { id, url: img.url, altText: altText || null };
  }
  const mediaId = await uploadFeaturedImage(localFilePath);
  const { json } = await wpRequest('POST', `/wp/v2/media/${mediaId}`, {
    body: {
      ...(altText ? { alt_text: altText } : {}),
      ...(title ? { title } : {}),
      ...(caption ? { caption } : {}),
    },
  });
  return { id: json.id, url: json.source_url, altText: json.alt_text };
}

// Resolves a post's numeric ID from its public URL/slug - so the human can just paste a link
// when choosing "replace this existing post".
async function findPostByUrl(url) {
  if (connectorOn()) {
    const p = await sitePost(slugFromUrl(url));
    if (!p) throw new Error(`No post found matching "${url}"`);
    return wpShape(p);
  }
  const { siteUrl, authHeader } = getConfig();
  const slugMatch = url.match(/\/([^\/]+)\/?$/);
  const slug = slugMatch ? slugMatch[1] : url;

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress find post failed (${res.status}): ${body}`);
  }
  const results = await res.json();
  if (!results.length) throw new Error(`No post found matching "${url}"`);
  return results[0];
}

// Before a blog goes live at an address: a post that holds the same address but was never live
// (a draft, pending or private copy, for example one sent here earlier as a draft) is moved to the
// trash, which frees the address. A live post is never touched: it is returned, so the caller can
// say the address is taken. Trash can be undone in WordPress for 30 days.
async function freeSlug(slug: string, keepId?: number | null): Promise<{ trashed: number[]; liveHolder: { id: number; link: string } | null }> {
  const out = { trashed: [] as number[], liveHolder: null as { id: number; link: string } | null };
  if (!slug) return out;
  if (connectorOn()) {
    // Nothing is deleted on the website; a taken address is reported, and a new post gets -2.
    const p = await sitePost(slug);
    if (p && toDashId(p.id) !== keepId && isLive(p.status)) out.liveHolder = { id: toDashId(p.id) as number, link: p.url };
    return out;
  }
  const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { slug, status: 'publish,future,draft,pending,private', context: 'edit', per_page: 20, _fields: 'id,status,link' } }).catch(() => ({ json: [] }));
  for (const p of Array.isArray(json) ? json : []) {
    if (p.id === keepId) continue;
    if (p.status === 'publish' || p.status === 'future') {
      out.liveHolder = { id: p.id, link: p.link };
      continue;
    }
    await wpRequest('DELETE', `/wp/v2/posts/${p.id}`).then(() => out.trashed.push(p.id)).catch(() => {});
  }
  return out;
}

// The few WordPress REST calls the dashboard makes about posts, answered from the website. Anything
// else (pages, Yoast, users, plugins, settings) is not on the new website.
async function siteRequest(method: string, route: string, query: any, body: any) {
  const headers = new Headers();
  const one = route.match(/^\/wp\/v2\/posts\/(\d+)$/);
  if (one && method === 'GET') {
    const p = await sitePost(await slugForId(one[1]));
    if (!p) throw Object.assign(new Error(`Website GET ${route} failed (404): not found`), { status: 404 });
    return { json: wpShape(p), headers };
  }
  // An empty save (refreshYoast) has nothing to do on the website.
  if (one && method === 'POST' && (!body || !Object.keys(body).length)) return { json: {}, headers };
  if (route === '/wp/v2/posts' && method === 'GET') {
    if (query.slug) {
      const p = await sitePost(String(query.slug));
      return { json: p ? [wpShape(p)] : [], headers };
    }
    if (query.search) {
      const words = String(query.search).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hits = (await sitePosts()).filter((p) => isLive(p.status) && words.some((w) => p.title.toLowerCase().includes(w))).slice(0, Number(query.per_page) || 10);
      const full = await Promise.all(hits.map((h) => sitePost(h.slug)));
      return { json: full.filter(Boolean).map(wpShape), headers };
    }
    // Paged like WordPress, so callers that loop over pages do not get the first page again each time.
    const per = Number(query.per_page) || 10;
    const page = Math.max(1, Number(query.page) || 1);
    const posts = (await sitePosts()).filter((p) => isLive(p.status)).slice((page - 1) * per, page * per);
    return { json: posts.map(wpShape), headers };
  }
  // No WordPress users any more: authors are the site's author slugs (lib/siteConnector.ts).
  if (route.startsWith('/wp/v2/users') && method === 'GET') return { json: [], headers };
  throw Object.assign(new Error(`Not available on the new website (this used WordPress ${method} ${route}).`), { status: 501 });
}

export {
  wpConfigured,
  freeSlug,
  testConnection,
  uploadBuffer,
  uploadFeaturedImage,
  uploadMedia,
  publishPost,
  updatePost,
  listPosts,
  getPost,
  findPostByUrl,
  wpRequest,
  seoSlug,
  refreshYoast,
};

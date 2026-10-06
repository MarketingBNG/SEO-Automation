import path from 'path';
import { readFile, basename } from './storage';

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
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
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
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
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

async function publishPost({ title, contentHtml, excerpt, featuredMediaId, status = 'draft', slug, metaDescription, focusKeyphrase }) {
  const { siteUrl, authHeader } = getConfig();

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
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
async function updatePost(postId, { title, contentHtml, excerpt, featuredMediaId, status, metaDescription, focusKeyphrase }) {
  const { siteUrl, authHeader } = getConfig();

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts/${postId}`, {
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
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,title,link,excerpt,modified`,
    { headers: { Authorization: authHeader } }
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
  const { siteUrl, authHeader } = getConfig();
  const res = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content,excerpt`,
    { headers: { Authorization: authHeader } }
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
  const { siteUrl, authHeader } = getConfig();
  const url = new URL(`${siteUrl}/wp-json${route}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }

  const res = await fetch(url, {
    method,
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
  const { siteUrl, authHeader } = getConfig();
  const slugMatch = url.match(/\/([^\/]+)\/?$/);
  const slug = slugMatch ? slugMatch[1] : url;

  const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}`, {
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

export {
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

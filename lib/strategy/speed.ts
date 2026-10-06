// @ts-nocheck -- reads untyped WordPress JSON.
// Automatic speed work through the WordPress REST API, run once a day by the scheduler:
//  1. Page cache: when no caching plugin is active, installs and activates the free "Cache Enabler"
//     plugin (it caches pages as soon as it is active). The home page is measured with PageSpeed
//     before and after; if the mobile score drops by more than 5 points the plugin is turned off again.
//  2. Images: large JPG/PNG uploads (over 200 KB) are re-compressed to WebP (max 1600 px wide), uploaded
//     as new media, and every post or page that shows the old image is switched to the new one
//     (srcset removed for that image, featured image swapped). The old content is saved for undo and the
//     original file is never deleted. A few images per day.
// Every action is a row in technical_fix_tasks (strategy_id 0) so it shows in the Activity Log and reports.
// Theme files and code are never changed.
import sharp from 'sharp';
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { wpRequest, uploadBuffer } from '../wordpress';
import { runPageSpeedCheck } from '../pagespeed';
import { notify } from '../notify';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const MIN_BYTES = 200 * 1024;
const MAX_WIDTH = 1600;

// Plugins that already cache pages; adding a second one causes conflicts.
const CACHE_PLUGINS = /^(wp-rocket|litespeed-cache|w3-total-cache|wp-super-cache|wp-fastest-cache|cache-enabler|sg-cachepress|breeze|hummingbird-performance|swift-performance|wp-optimize|nitropack|flying-press|perfmatters|autoptimize)\//;

async function record(kind: string, url: string, issue: string, fix: string, status: string, result: string) {
  const row = await prisma.technical_fix_tasks.create({ data: { strategy_id: 0, url, issue, fix, kind, status, result, applied_at: sqlNow() } });
  await activity.log(`speed.${status}`, { entityType: 'technical_fix', entityId: row.id, details: `${url}: ${result}` });
  return row;
}

async function mobileScore(url: string) {
  try {
    return (await runPageSpeedCheck(url, 'mobile')).scores.performance;
  } catch {
    return null;
  }
}

export async function ensurePageCache({ score = mobileScore } = {}) {
  const done = await prisma.technical_fix_tasks.findFirst({ where: { strategy_id: 0, kind: 'cache' } });
  if (done) return { skipped: `already handled: ${done.result}` };
  const { json: plugins } = await wpRequest('GET', '/wp/v2/plugins');
  const active = (plugins || []).filter((p) => p.status === 'active').map((p) => String(p.plugin));
  const existing = active.find((p) => CACHE_PLUGINS.test(p));
  if (existing) {
    await record('cache', SITE(), 'Page caching', 'Keep the caching plugin already active', 'applied', `A caching plugin is already active (${existing.split('/')[0]}); nothing installed.`);
    return { existing };
  }
  const home = `${SITE()}/`;
  const before = await score(home);
  const installed = (plugins || []).find((p) => String(p.plugin).startsWith('cache-enabler/'));
  if (installed) await wpRequest('POST', `/wp/v2/plugins/${installed.plugin.replace(/\.php$/, '')}`, { body: { status: 'active' } });
  else await wpRequest('POST', '/wp/v2/plugins', { body: { slug: 'cache-enabler', status: 'active' } });
  // Let the cache warm up with a couple of visits before measuring again.
  for (let i = 0; i < 2; i++) await fetch(home).catch(() => null);
  const after = await score(home);
  if (before !== null && after !== null && after < before - 5) {
    const { json } = await wpRequest('GET', '/wp/v2/plugins', { query: { search: 'cache-enabler' } });
    const p = (json || []).find((x) => String(x.plugin).startsWith('cache-enabler/'));
    if (p) await wpRequest('POST', `/wp/v2/plugins/${p.plugin.replace(/\.php$/, '')}`, { body: { status: 'inactive' } });
    await record('cache', home, 'Page caching', 'Cache Enabler plugin', 'manual', `Turned off again: mobile PageSpeed fell from ${before} to ${after}. A developer should look at caching.`);
    return { before, after, rolledBack: true };
  }
  await record('cache', home, 'Page caching', 'Cache Enabler plugin', 'applied', `Cache Enabler installed and active. Mobile PageSpeed ${before ?? 'n/a'} before, ${after ?? 'n/a'} after.`);
  return { before, after };
}

// Swaps every use of an image (and its resized copies) for the new file, dropping srcset/sizes on it.
export function swapImage(html: string, oldUrl: string, newUrl: string) {
  const m = oldUrl.match(/^(.*\/)([^/]+?)\.(jpe?g|png)$/i);
  if (!m) return html;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stem = m[2].replace(/-scaled$/i, '');
  const variant = new RegExp(`${esc(m[1])}${esc(stem)}(?:-scaled)?(?:-\\d+x\\d+)?\\.${m[3]}`, 'gi');
  let out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!variant.test(tag)) return tag;
    variant.lastIndex = 0;
    return tag.replace(/\s(srcset|sizes)=("[^"]*"|'[^']*')/gi, '').replace(variant, newUrl);
  });
  variant.lastIndex = 0;
  out = out.replace(variant, newUrl);
  return out;
}

async function usesOf(media) {
  const name = String(media.source_url).split('/').pop().replace(/\.(jpe?g|png)$/i, '');
  const found = [];
  for (const type of ['posts', 'pages']) {
    const { json } = await wpRequest('GET', `/wp/v2/${type}`, { query: { search: name, per_page: 20, context: 'edit', _fields: 'id,link,content,featured_media' } }).catch(() => ({ json: [] }));
    for (const p of json || []) if (String(p.content?.raw || '').includes(name) || p.featured_media === media.id) found.push({ type, p });
  }
  // Featured image only (not in the text): search does not find these, so check by featured_media.
  for (const type of ['posts', 'pages']) {
    const { json } = await wpRequest('GET', `/wp/v2/${type}`, { query: { per_page: 50, context: 'edit', _fields: 'id,link,content,featured_media', orderby: 'modified' } }).catch(() => ({ json: [] }));
    for (const p of json || []) if (p.featured_media === media.id && !found.some((f) => f.type === type && f.p.id === p.id)) found.push({ type, p });
  }
  return found;
}

export async function compressImages({ max = 5, fetchBytes = async (u) => Buffer.from(await (await fetch(u)).arrayBuffer()) } = {}) {
  const out = { converted: 0, skipped: 0, failed: 0, savedKb: 0 };
  const seen = new Set((await prisma.technical_fix_tasks.findMany({ where: { strategy_id: 0, kind: 'image' }, select: { url: true } })).map((r) => r.url));
  for (let page = 1; page <= 5 && out.converted < max; page++) {
    const { json: media } = await wpRequest('GET', '/wp/v2/media', { query: { media_type: 'image', per_page: 50, page, _fields: 'id,source_url,mime_type,media_details,alt_text,title' } }).catch(() => ({ json: [] }));
    if (!media?.length) break;
    for (const m of media) {
      if (out.converted >= max) break;
      if (!/image\/(jpeg|png)/.test(m.mime_type) || seen.has(m.source_url)) continue;
      const size = m.media_details?.filesize;
      if (size && size < MIN_BYTES) continue;
      try {
        const original = await fetchBytes(m.source_url);
        if (original.length < MIN_BYTES) continue;
        const webp = await sharp(original).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        if (webp.length > original.length * 0.7) {
          await record('image', m.source_url, `Large image (${Math.round(original.length / 1024)} KB)`, 'Convert to WebP', 'applied', `Already well compressed; WebP would save under 30%. Left as is.`);
          out.skipped++;
          continue;
        }
        const uses = await usesOf(m);
        const base = String(m.source_url).split('/').pop().replace(/\.(jpe?g|png)$/i, '');
        const uploaded = await uploadBuffer(webp, `${base}.webp`, 'image/webp');
        if (m.alt_text) await wpRequest('POST', `/wp/v2/media/${uploaded.id}`, { body: { alt_text: m.alt_text } }).catch(() => null);
        for (const { type, p } of uses) {
          const raw = String(p.content?.raw || '');
          const next = swapImage(raw, m.source_url, uploaded.source_url);
          const body: any = {};
          if (next !== raw) body.content = next;
          if (p.featured_media === m.id) body.featured_media = uploaded.id;
          if (!Object.keys(body).length) continue;
          await prisma.site_changes.create({ data: { tool: 'speed_image', summary: `Image ${base} switched to WebP on ${p.link}`, target_type: type, target_id: String(p.id), undo: JSON.stringify({ content: raw, featured_media: p.featured_media }) } });
          await wpRequest('POST', `/wp/v2/${type}/${p.id}`, { body });
        }
        const saved = Math.round((original.length - webp.length) / 1024);
        await record('image', m.source_url, `Large image (${Math.round(original.length / 1024)} KB)`, 'Convert to WebP', 'applied', `WebP ${Math.round(webp.length / 1024)} KB (saved ${saved} KB), used on ${uses.length} page(s). Original kept in the Media Library.`);
        out.converted++;
        out.savedKb += saved;
      } catch (e: any) {
        await record('image', m.source_url, 'Large image', 'Convert to WebP', 'failed', String(e.message || e).slice(0, 300));
        out.failed++;
      }
    }
  }
  return out;
}

export async function runSpeedFixes() {
  const out: any = {};
  out.cache = await ensurePageCache().catch((e) => ({ error: e.message }));
  out.images = await compressImages().catch((e) => ({ error: e.message }));
  const i = out.images;
  if (i && !i.error && (i.converted || i.failed)) {
    await notify(`Speed: ${i.converted} image(s) converted to WebP, ${i.savedKb} KB saved${i.failed ? `, ${i.failed} failed` : ''}`, 'See the Activity Log for each image and page.').catch(() => {});
  }
  return out;
}

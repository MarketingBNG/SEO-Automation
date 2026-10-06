// After-publish indexing. IndexNow tells Bing (and Yandex, Seznam, Naver) about a new or updated URL.
// Google has no public "request indexing" API for normal pages, so the honest equivalent is
// resubmitting the sitemap in Search Console, which prompts a recrawl.
import { google } from 'googleapis';
import { googleAuth, getSiteUrl } from './searchConsole';

export async function submitIndexNow(urls: string[]) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) throw new Error('INDEXNOW_KEY is not set');
  const site = new URL(process.env.WORDPRESS_SITE_URL || urls[0]);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: site.host, key, keyLocation: process.env.INDEXNOW_KEY_LOCATION || `${site.origin}/${key}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(20000),
  });
  if (![200, 202].includes(res.status)) throw new Error(`IndexNow returned ${res.status}`);
  return res.status;
}

// Needs the service account to have Owner or Full access on the Search Console property.
export async function resubmitSitemap() {
  const sitemap = process.env.SITEMAP_URL || `${(process.env.WORDPRESS_SITE_URL || '').replace(/\/+$/, '')}/sitemap_index.xml`;
  const auth = googleAuth(['https://www.googleapis.com/auth/webmasters']);
  const sc = google.searchconsole({ version: 'v1', auth });
  await sc.sitemaps.submit({ siteUrl: getSiteUrl(), feedpath: sitemap });
  return sitemap;
}

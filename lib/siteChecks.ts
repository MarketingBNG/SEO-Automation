// @ts-nocheck -- reads untyped WordPress JSON.
// Daily checks on the live website (audit items A1 and K11):
//  - every published post is scanned for AI instruction text, chat lines and placeholders;
//  - robots.txt must list the sitemap;
//  - image attachment pages must not be indexable pages of their own.
// Each problem becomes a task for a person (Monthly Strategy > tasks) with an alert, once.
import prisma from './prisma';
import { wpRequest } from './wordpress';
import { notify } from './notify';
import { aiLeftovers } from './strategy/core';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');

async function addTask(url: string, issue: string, fix: string) {
  const exists = await prisma.technical_fix_tasks.findFirst({ where: { url, issue, status: { in: ['manual', 'planned'] } } });
  if (exists) return false;
  await prisma.technical_fix_tasks.create({ data: { strategy_id: 0, url, issue, fix, kind: 'manual', status: 'manual', result: 'Found by the daily website check.' } });
  return true;
}

export async function scanPostsForAiText(maxPages = 5) {
  const found = [];
  for (let page = 1; page <= maxPages; page++) {
    const { json } = await wpRequest('GET', '/wp/v2/posts', { query: { per_page: 100, page, status: 'publish', context: 'edit', _fields: 'id,link,title,content' } }).catch(() => ({ json: [] }));
    if (!Array.isArray(json) || !json.length) break;
    for (const p of json) {
      const issues = aiLeftovers(p.title?.raw || '', p.content?.raw || '');
      if (issues.length) found.push({ url: p.link, title: p.title?.raw || p.link, issues });
    }
    if (json.length < 100) break;
  }
  return found;
}

export async function runSiteChecks() {
  const out: any = { aiText: 0, robots: null, attachments: null, newTasks: 0 };
  // 1. AI instruction text on live posts.
  const ai = await scanPostsForAiText();
  out.aiText = ai.length;
  for (const p of ai) {
    if (await addTask(p.url, 'AI instruction text on a live post', `Edit the post in WordPress and remove: ${p.issues.join(' ')}`)) out.newTasks++;
  }

  // 2. Sitemap listed in robots.txt.
  try {
    const txt = await (await fetch(`${SITE()}/robots.txt`, { signal: AbortSignal.timeout(15000) })).text();
    out.robots = /^\s*sitemap:\s*https?:\/\//im.test(txt) ? 'ok' : 'missing';
    if (out.robots === 'missing' && (await addTask(`${SITE()}/robots.txt`, 'Sitemap missing from robots.txt', `Add the line "Sitemap: ${SITE()}/sitemap_index.xml" (Yoast: SEO > Tools > File editor)`))) out.newTasks++;
  } catch (e) {
    out.robots = `not checked: ${e.message}`;
  }

  // 3. Image attachment pages should redirect to the image (Yoast: Settings > Advanced > Media pages).
  try {
    const { json } = await wpRequest('GET', '/wp/v2/media', { query: { per_page: 1, _fields: 'link,source_url' } });
    const link = json?.[0]?.link;
    if (link && json[0].source_url && link !== json[0].source_url) {
      const res = await fetch(link, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const html = res.status === 200 ? await res.text() : '';
      const indexable = res.status === 200 && !/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html);
      out.attachments = indexable ? 'indexable' : 'ok';
      if (indexable && (await addTask(link, 'Image attachment pages are indexable', 'In Yoast SEO: Settings > Advanced > Media pages, turn off "Enable media pages" so each image URL redirects to the image itself'))) out.newTasks++;
    } else out.attachments = 'ok';
  } catch (e) {
    out.attachments = `not checked: ${e.message}`;
  }

  if (out.newTasks) {
    await notify(
      `Website check: ${out.newTasks} new problem(s) need a person`,
      `${ai.length ? `AI instruction text on ${ai.length} live post(s): ${ai.slice(0, 5).map((p) => p.url).join(', ')}. ` : ''}${out.robots === 'missing' ? 'The sitemap is missing from robots.txt. ' : ''}${out.attachments === 'indexable' ? 'Image attachment pages are indexable. ' : ''}See the task list in Monthly Strategy.`,
      { action: 'alert.site_check' }
    );
  }
  return out;
}

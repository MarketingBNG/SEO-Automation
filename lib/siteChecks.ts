// @ts-nocheck -- untyped task rows and fetch results.
// Daily checks on the live website (audit items A1 and K11):
//  - every published post is scanned for AI instruction text, chat lines and placeholders;
//  - robots.txt must list the sitemap.
// Each problem becomes a task for a person (Monthly Strategy > tasks) with an alert, once.
import prisma from './prisma';
import { livePosts } from './site';
import { siteOrigin } from './siteConnector';
import { notify } from './notify';
import { aiLeftovers } from './strategy/core';

// No default domain: a local or test server without SITE_URL or the website connection must not
// fetch the live site.
const SITE = () => siteOrigin();

async function addTask(url: string, issue: string, fix: string) {
  const exists = await prisma.technical_fix_tasks.findFirst({ where: { url, issue, status: { in: ['manual', 'planned'] } } });
  if (exists) return false;
  await prisma.technical_fix_tasks.create({ data: { strategy_id: 0, url, issue, fix, kind: 'manual', status: 'manual', result: 'Found by the daily website check.' } });
  return true;
}

// The website could not be read at all: the caller hears of it.
export async function scanPostsForAiText() {
  const found = [];
  for (const p of await livePosts({ full: true, fresh: true })) {
    const issues = aiLeftovers(p.title || '', p.content || '');
    if (issues.length) found.push({ url: p.link, title: p.title || p.link, issues });
  }
  return found;
}

export async function runSiteChecks() {
  const out: any = { aiText: 0, robots: null, newTasks: 0 };
  // 1. AI instruction text on live posts.
  let ai = [];
  let scanFailed = false;
  try {
    ai = await scanPostsForAiText();
    out.aiText = ai.length;
  } catch (e) {
    scanFailed = true;
    out.aiText = `not checked: ${e.message}`;
  }
  for (const p of ai) {
    if (await addTask(p.url, 'AI instruction text on a live post', `Edit the post on the website and remove: ${p.issues.join(' ')}`)) out.newTasks++;
  }

  // 2. Sitemap listed in robots.txt.
  if (!SITE()) out.robots = 'not checked: neither SITE_URL nor the website connection is set';
  else {
    try {
      const txt = await (await fetch(`${SITE()}/robots.txt`, { signal: AbortSignal.timeout(15000) })).text();
      out.robots = /^\s*sitemap:\s*https?:\/\//im.test(txt) ? 'ok' : 'missing';
      if (out.robots === 'missing' && (await addTask(`${SITE()}/robots.txt`, 'Sitemap missing from robots.txt', `Ask the developer to add the line "Sitemap: ${process.env.SITEMAP_URL || `${SITE()}/sitemap.xml`}" to robots.txt on the website`))) out.newTasks++;
    } catch (e) {
      out.robots = `not checked: ${e.message}`;
    }
  }

  // Nothing could be checked (no connection, or the website is down): an error, so the scheduler
  // keeps the day open and tries again on its next run instead of marking today's check done.
  if (scanFailed && /^not checked/.test(String(out.robots))) {
    out.error = `Website not reachable: ${out.aiText.slice('not checked: '.length)}`;
  }

  if (out.newTasks) {
    await notify(
      `Website check: ${out.newTasks} new problem(s) need a person`,
      `${ai.length ? `AI instruction text on ${ai.length} live post(s): ${ai.slice(0, 5).map((p) => p.url).join(', ')}. ` : ''}${out.robots === 'missing' ? 'The sitemap is missing from robots.txt. ' : ''}See the task list in Monthly Strategy.`,
      { action: 'alert.site_check' }
    );
  }
  return out;
}

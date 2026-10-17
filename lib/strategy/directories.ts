// @ts-nocheck -- reads untyped Claude JSON.
// Daily directory listings: every day after 10:00 IST the approved strategy's "directories per day"
// (default 5) new, legitimate business directories are added as tasks for a person (sign-up and
// verification need a human). Claude finds them with web search; each must be a real, live site,
// relevant to a CFO, tax and accounting firm serving US and India businesses, with free or standard
// listings (never paid-link schemes), and never one we already have a task for. Each task gets its
// step-by-step guide on demand ("How to do it"), as before.
import prisma from '../prisma';
import * as settings from '../settings';
import * as activity from '../activity';
import { callClaude } from '../anthropic';
import { parseJson } from './generate';
import { directoryTargets } from './core';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const METHOD = 'Directory or citation listing';
const domainOf = (s: string) => String(s || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).getUTCHours();

async function isLive(url: string) {
  const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch(() => null);
  return !!res && res.status < 500 && res.status !== 404 && res.status !== 410;
}

export async function findDirectories(count: number, exclude: string[]) {
  const { text } = await callClaude(
    `You pick business directories and citation sites for ${SITE()}, a CFO, tax, accounting and compliance firm (BNG Advisors Private Limited, brand USAIndiaCFO) serving Indian founders with US companies, NRIs and US-India businesses.
Quality rules, all required:
- A real, established, currently live directory with real traffic, that Google trusts (for example B2B service marketplaces, accounting and finance directories, startup databases, local business listings in the US and India, maps and review platforms, chambers of commerce).
- Relevant to professional services, accounting, tax, finance, startups or US/India business.
- Listing is free or a normal company profile. Never paid-link schemes, link farms, PBNs, "submit to 1000 directories" lists, spam or low-quality article directories.
- Use web search and open the page to confirm the sign-up page exists. Never invent a domain or URL.
Return ONLY JSON between ===JSON=== and ===END===: [{"name":"...","domain":"example.com","signupUrl":"https://...","why":"one line: what it is and why it helps (audience, authority)","type":"B2B marketplace|accounting directory|startup database|local listing|review site|other"}]`,
    [{ role: 'user', content: `Give exactly ${count} directories. Already used (never repeat): ${exclude.join(', ') || 'none'}.` }],
    undefined,
    { maxUses: 10, effort: 'medium', feature: 'outreach' }
  );
  const rows = parseJson(text);
  return Array.isArray(rows) ? rows : [];
}

// The names a directory goes by, to spot repeats: the domain's main word (clutch.co -> clutch) and
// the listing's name (Clutch, GoodFirms...). Older tasks were written as "Clutch (company profile for
// ...)", so the name before the bracket counts too.
export function directoryKeys(targetSite: string): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = new Set<string>();
  const inBracket = (targetSite.match(/\(([^)]+)\)/) || [])[1] || '';
  const domain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(inBracket.trim()) ? domainOf(inBracket) : /\./.test(targetSite) && !/\s/.test(targetSite.trim()) ? domainOf(targetSite) : '';
  if (domain) out.add(norm(domain.split('.').slice(0, -1).join('.') || domain));
  const name = targetSite.replace(/\(.*?\)/g, '').replace(/^data missing.*$/i, '').trim();
  if (name && !/\s.*\s.*\s/.test(name)) out.add(norm(name));
  else if (name) out.add(norm(name.split(/\s+/).slice(0, 2).join('')));
  return [...out].filter((k) => k.length >= 3);
}

// Open directory tasks that repeat an earlier one (done or open) are taken off the list, keeping the
// earliest. Runs with every daily run.
export async function removeDuplicateDirectories(): Promise<number> {
  const rows = await prisma.backlink_tasks.findMany({ where: { method: { contains: 'irectory' }, status: { in: ['manual', 'done', 'planned'] } }, orderBy: { id: 'asc' } });
  const seen = new Set<string>();
  let removed = 0;
  for (const r of rows) {
    const keys = directoryKeys(r.target_site);
    const dup = keys.some((k) => seen.has(k));
    keys.forEach((k) => seen.add(k));
    if (dup && r.status !== 'done') {
      await prisma.backlink_tasks.update({ where: { id: r.id }, data: { status: 'skipped', note: `Removed: the same directory was already given earlier. ${r.note || ''}`.slice(0, 1000) } });
      removed++;
    }
  }
  if (removed) await activity.log('directories.duplicates_removed', { details: `${removed} repeated directory task(s) removed` });
  return removed;
}

// Called by the scheduler every 15 minutes; runs once a day after 10:00 IST.
export async function directoriesTick(now = new Date(), find = findDirectories) {
  if (!(await settings.get('directories_dedupe_v1'))) {
    await removeDuplicateDirectories().catch(() => 0);
    await settings.set('directories_dedupe_v1', new Date().toISOString());
  }
  if (istHour(now) < 10) return null;
  const today = istDay(now);
  if ((await settings.get('directories_last_day')) === today) return null;
  const strategy =
    (await prisma.seo_strategies.findFirst({ where: { status: 'approved', start_date: { lte: today }, end_date: { gte: today } }, orderBy: { id: 'desc' } })) ||
    (await prisma.seo_strategies.findFirst({ where: { status: 'approved' }, orderBy: { id: 'desc' } }));
  if (!strategy?.plan_json) return null;
  const { perDay } = directoryTargets(JSON.parse(strategy.plan_json));
  await settings.set('directories_last_day', today);
  if (!perDay) return null;

  await removeDuplicateDirectories();
  const used = await prisma.backlink_tasks.findMany({ where: { method: { contains: 'irectory' } }, select: { target_site: true } });
  const usedKeys = new Set(used.flatMap((u) => directoryKeys(u.target_site)));
  // What Claude is told to avoid: every directory name and domain we already have a task for.
  const exclude = [...new Set(used.map((u) => u.target_site.replace(/\s*\((?![a-z0-9-]+\.[a-z.]+\)).*?\)\s*/gi, ' ').trim()).filter(Boolean))].slice(0, 300);
  const found = await find(perDay + 3, exclude);
  let added = 0;
  for (const d of found) {
    if (added >= perDay) break;
    const domain = domainOf(d.domain || d.signupUrl);
    if (!domain || domain.endsWith(domainOf(SITE()))) continue;
    // Same directory as one we already gave (by name or domain): never again.
    const keys = directoryKeys(`${d.name || ''} (${domain})`);
    if (keys.some((k) => usedKeys.has(k))) continue;
    const signup = /^https?:\/\//.test(d.signupUrl || '') ? d.signupUrl : `https://${domain}`;
    if (!(await isLive(signup)) && !(await isLive(`https://${domain}`))) continue;
    keys.forEach((k) => usedKeys.add(k));
    await prisma.backlink_tasks.create({
      data: {
        strategy_id: strategy.id,
        target_site: `${String(d.name || domain).slice(0, 80)} (${domain})`,
        method: METHOD,
        our_page: SITE() + '/',
        send_date: today,
        tags: JSON.stringify(['Directory']),
        status: 'manual',
        note: `Sign up: ${signup}. ${String(d.why || '').slice(0, 200)} Directory sign-up needs a person (forms and verification).`,
      },
    });
    added++;
  }
  await activity.log('directories.daily', { entityType: 'seo_strategy', entityId: strategy.id, details: `${added} of ${perDay} new directory listings added for ${today}` });
  return added;
}

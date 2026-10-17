// @ts-nocheck -- reads untyped Claude JSON.
// Daily directory listings: every day after 10:00 IST the approved strategy's "directories per day"
// (default 5) new, legitimate business directories are added as tasks for a person (sign-up and
// verification need a human). Claude finds them with web search (batch mode: half price, same answer, nobody waits on it); each must be a real, live site,
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

// Sites where our competitors already have links or listings and we do not (SE Ranking backlink gap,
// answers kept 24 hours). The best directories for us are the ones our niche already uses.
export async function competitorSites(): Promise<{ competitors: string[]; sites: { domain: string; linksTo: string[] }[] }> {
  const { competitorList } = await import('../competitors');
  const competitors = (await competitorList().catch(() => ({ domains: [] as string[] }))).domains.slice(0, 5);
  if (!competitors.length || !process.env.SERANKING_API_KEY) return { competitors, sites: [] };
  const { getBacklinkGap } = await import('../seranking');
  const sites = await getBacklinkGap(domainOf(SITE()), competitors, 120).catch(() => []);
  return { competitors, sites };
}

export async function findDirectories(count: number, exclude: string[]) {
  const { competitors, sites } = await competitorSites();
  const gap = sites.length ? sites.map((x) => `${x.domain} (links to: ${x.linksTo.join(', ')})`).join('\n') : 'none available';
  const { text } = await callClaude(
    `You pick business directories and listing sites for ${SITE()}, a CFO, tax, accounting and compliance firm (BNG Advisors Private Limited, brand USAIndiaCFO) serving Indian founders with US companies, NRIs and US-India businesses.
Our competitors in this niche: ${competitors.join(', ') || 'not known; find firms that sell US-India tax, accounting and CFO services with a web search'}.
Rules, all required:
- PREFER sites where these competitors (or other US-India tax, accounting or CFO firms) are already listed or have a profile. Check with web search (for example search the site for a competitor's name) and say which competitor you found there.
- The site must let an accounting, tax, CFO, finance or professional-services firm create its own listing or company profile. NEVER sites that only list advertising, marketing, design or software agencies, NEVER job portals or job boards, never freelancer gig sites, never news sites or blogs that sell posts.
- A real, established, live directory or listing platform with real traffic: B2B service marketplaces that include accounting/finance, accounting and tax directories, CPA/CA directories, startup databases, US and India business listings, chambers of commerce, review platforms for professional services.
- Free or normal company profile. Never paid-link schemes, link farms, PBNs, mass-submission lists or spam directories.
- Confirm the sign-up or "list your firm" page exists by opening it. Never invent a domain or URL.
Return ONLY JSON between ===JSON=== and ===END===: [{"name":"...","domain":"example.com","signupUrl":"https://...","competitorsListed":["competitor.com"],"why":"one line: what it is, who uses it, why it helps us","type":"B2B marketplace|accounting directory|CPA/CA directory|startup database|local listing|review site|chamber|other"}]`,
    [{ role: 'user', content: `Give exactly ${count} directories, best first.\nSites that link to our competitors but not to us (check these first; keep only real directories or listing sites that fit the rules):\n${gap}\n\nAlready given to us (never repeat): ${exclude.join(', ') || 'none'}.` }],
    undefined,
    { maxUses: 15, effort: 'medium', feature: 'outreach', batch: true }
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
        note: `Sign up: ${signup}. ${String(d.why || '').slice(0, 200)}${Array.isArray(d.competitorsListed) && d.competitorsListed.length ? ` Competitors listed here: ${d.competitorsListed.slice(0, 4).join(', ')}.` : ''} Directory sign-up needs a person (forms and verification).`,
      },
    });
    added++;
  }
  await activity.log('directories.daily', { entityType: 'seo_strategy', entityId: strategy.id, details: `${added} of ${perDay} new directory listings added for ${today}` });
  return added;
}

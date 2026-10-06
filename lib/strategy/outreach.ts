// @ts-nocheck -- reads untyped HTML and SE Ranking JSON.
// Automatic backlink outreach for the approved strategy, through Smartlead. For each backlink task
// due today the dashboard:
//  1. finds a contact email on the target site (contact, about and home pages),
//  2. skips it if that email was already pushed here or Smartlead already has it as a lead,
//  3. has Claude write a personalised opening line for that site,
//  4. adds the prospect as a lead to the Smartlead campaign (SMARTLEAD_CAMPAIGN_ID), at most
//     OUTREACH_DAILY_LIMIT (default 5) per day. Smartlead sends the emails and follow-ups and
//     rotates the mailboxes,
//  5. marks the task done when SE Ranking finds the new link.
// Directory listings need sign-up forms and captchas, so they are marked for a person.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { parseJson } from './generate';
import { callClaude } from '../anthropic';
import { listReferringDomains } from '../seranking';
import { smartleadConfigured, leadExists, addLead } from '../smartlead';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const HOST = () => SITE().replace(/^https?:\/\//, '').replace(/^www\./, '');
const DAILY_LIMIT = () => Number(process.env.OUTREACH_DAILY_LIMIT || 5);

export const domainOf = (site: string) => String(site || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

export function outreachMethod(method: string): 'email' | 'internal' | 'manual' {
  if (/internal/i.test(method)) return 'internal';
  if (/directory|citation/i.test(method)) return 'manual';
  return 'email';
}

const SKIP_EMAIL = /^(no-?reply|donotreply|privacy|abuse|postmaster|example|user|name|email|your)@|\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|@example\./i;

// Picks the best contact email from page HTML: one on the site's own domain first.
export function pickEmail(html: string, domain: string): string | null {
  const found = [...new Set((html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))].filter((e) => !SKIP_EMAIL.test(e));
  if (!found.length) return null;
  const own = found.filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`));
  const pool = own.length ? own : found;
  return pool.find((e) => /^(editor|editorial|content|hello|contact|info|partnerships?|marketing)@/.test(e)) || pool[0];
}

// First and last name only when the address clearly is a person's (jane.doe@ or jane_doe@).
export function nameFromEmail(email: string): { first_name: string; last_name: string } {
  const local = email.split('@')[0];
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  const generic = /^(info|contact|hello|editor|editorial|content|admin|support|team|marketing|partnerships?|office|sales|press|media|news)$/i;
  if (parts.length !== 2 || parts.some((p) => generic.test(p))) return { first_name: '', last_name: '' };
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase();
  return { first_name: cap(parts[0]), last_name: cap(parts[1]) };
}

export function companyFromHtml(html: string, domain: string) {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,80})["']/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i)?.[1]?.split(/\s[|\-:]\s/).pop();
  return (og || title || domain).replace(/&amp;/g, '&').trim();
}

async function fetchText(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; USAIndiaCFO-outreach)' } });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

export async function findContact(site: string) {
  const domain = domainOf(site);
  let company = '';
  for (const path of ['/', '/contact', '/contact-us', '/about', '/about-us', '/write-for-us']) {
    const html = await fetchText(`https://${domain}${path}`);
    if (!html) continue;
    if (path === '/') company = companyFromHtml(html, domain);
    const email = pickEmail(html.replace(/&#64;|\[at\]|\(at\)/gi, '@'), domain);
    if (email) return { email, company: company || domain, domain };
  }
  return null;
}

async function openingLine(task: any, company: string) {
  const { text } = await callClaude(
    `You write ONE personalised opening line (max 30 words) for a link outreach email from ${HOST()} (cross-border CFO, tax and compliance services for US and India businesses) to ${company}.
Mention something specific and true about their site or content (check it with a web search). No flattery, no em dashes, no quotes. Return only the line.`,
    [{ role: 'user', content: `Target site: ${task.target_site}\nOutreach angle: ${task.method}\nOur page: ${task.our_page}` }],
    undefined,
    { maxUses: 2, effort: 'medium', feature: 'outreach' }
  );
  return text.trim().replace(/^["']|["']$/g, '').replace(/—/g, ',');
}


// A task whose target is a description ("Pages linking to outdated ITIN guides") instead of a website.
export const isRealSite = (site: string) => !/\s/.test(String(site || '').trim()) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(domainOf(site));

// Turns a described target into real websites with a web search (a few cents per task).
async function findSites(task: any) {
  const { text } = await callClaude(
    `You find real websites for a safe link-building task for ${HOST()} (cross-border CFO, tax and compliance for US and India businesses).
Task method: ${task.method}. Use web search. Return up to 3 real, currently live sites that match the description and could reasonably link to our page.
Never news giants, government sites, forums, social networks, paid-link or guest-post-for-sale sites. Never invent a domain.
Return ONLY ===JSON===[{"domain":"example.com","why":"one line"}]===END===`,
    [{ role: 'user', content: `Description: ${task.target_site}\nOur page: ${task.our_page}` }],
    undefined,
    { maxUses: 6, effort: 'medium', feature: 'outreach' }
  );
  const rows = parseJson(text);
  return (Array.isArray(rows) ? rows : []).map((r) => domainOf(r.domain)).filter((d) => isRealSite(d) && !d.endsWith(HOST()));
}

const pageUrl = (p: string) => (p?.startsWith('http') ? p : `${SITE()}${p?.startsWith('/') ? '' : '/'}${p || ''}`);

// One pass: link check, then new leads for Smartlead within the daily cap. `line` is injectable for tests.
export async function runOutreach(now = new Date(), { checkLinks = true, line: writeLine = openingLine, find = findSites }: any = {}) {
  const out = { pushed: 0, duplicates: 0, verified: 0, noContact: 0, manual: 0, skipped: '' };
  const today = now.toISOString().slice(0, 10);
  const strategies = await prisma.seo_strategies.findMany({ where: { status: 'approved' }, select: { id: true } });
  const tasks = await prisma.backlink_tasks.findMany({ where: { strategy_id: { in: strategies.map((s) => s.id) }, status: { in: ['planned', 'sent'] } }, orderBy: { id: 'asc' } });

  // Internal links are added automatically with every published blog; directories need a person.
  for (const t of tasks.filter((x) => x.status === 'planned' && outreachMethod(x.method) !== 'email')) {
    const internal = outreachMethod(t.method) === 'internal';
    await prisma.backlink_tasks.update({ where: { id: t.id }, data: internal ? { status: 'done', note: 'Done automatically with each published blog.' } : { status: 'manual', note: 'Directory sign-up needs a person (forms and captchas).' } });
    t.status = internal ? 'done' : 'manual';
    if (!internal) out.manual++;
  }

  // Described targets become real websites (at most 3 tasks a day, to keep AI cost low).
  let resolveBudget = smartleadConfigured() ? 3 : 0;
  for (const t of tasks.filter((x) => x.status === 'planned' && outreachMethod(x.method) === 'email' && !isRealSite(x.target_site))) {
    if (/data missing/i.test(t.target_site)) {
      await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'skipped', note: 'Placeholder, not a real target. Use "Update with latest changes" to add real backlink-gap sites.' } });
      t.status = 'skipped';
      continue;
    }
    if (resolveBudget-- <= 0) break;
    try {
      const sites = await find(t);
      if (!sites.length) {
        await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'no_contact', note: `No real site found for: ${t.target_site}` } });
        t.status = 'no_contact';
        continue;
      }
      const [first, ...more] = sites;
      await prisma.backlink_tasks.update({ where: { id: t.id }, data: { target_site: first, note: `Found for: ${t.target_site}` } });
      for (const d of more) {
        const extra = await prisma.backlink_tasks.create({ data: { strategy_id: t.strategy_id, target_site: d, method: t.method, our_page: t.our_page, send_date: t.send_date, tags: t.tags, note: `Found for: ${t.target_site}` } });
        tasks.push(extra);
      }
      await activity.log('backlink.targets_found', { entityType: 'backlink_task', entityId: t.id, details: `${t.target_site} -> ${sites.join(', ')}` });
      t.target_site = first;
    } catch (e: any) {
      await activity.log('backlink.failed', { entityType: 'backlink_task', entityId: t.id, details: String(e.message || e).slice(0, 300) });
    }
  }

  // Link check: a target that now appears among our referring domains is done.
  const sent = tasks.filter((t) => t.status === 'sent');
  if (checkLinks && sent.length) {
    const refs = new Set(await listReferringDomains(HOST(), 1000).catch(() => []));
    for (const t of sent) {
      if (refs.has(domainOf(t.target_site))) {
        await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'done', verified_at: sqlNow(now) } });
        await activity.log('backlink.live', { entityType: 'backlink_task', entityId: t.id, details: `Link from ${t.target_site} found in SE Ranking` });
        out.verified++;
      }
    }
  }

  if (!smartleadConfigured()) {
    out.skipped = 'Outreach is not set up: add SMARTLEAD_API_KEY and SMARTLEAD_CAMPAIGN_ID in Coolify.';
    return out;
  }
  const pushedToday = await prisma.backlink_tasks.count({ where: { sent_at: { startsWith: today } } });
  let budget = Math.max(0, DAILY_LIMIT() - pushedToday);

  for (const t of tasks.filter((x) => x.status === 'planned' && outreachMethod(x.method) === 'email' && isRealSite(x.target_site) && (!x.send_date || x.send_date.slice(0, 10) <= today))) {
    if (budget <= 0) break;
    try {
      const contact = await findContact(t.target_site);
      if (!contact) {
        await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'no_contact', note: 'No contact email found on the site.' } });
        out.noContact++;
        continue;
      }
      // Duplicates: already pushed from here, or already a lead in Smartlead.
      const pushedHere = await prisma.backlink_tasks.findFirst({ where: { contact_email: contact.email, sent_at: { not: null } }, select: { id: true } });
      if (pushedHere || (await leadExists(contact.email))) {
        await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'duplicate', contact_email: contact.email, note: 'This contact is already in Smartlead; not added again.' } });
        out.duplicates++;
        continue;
      }
      const line = await writeLine(t, contact.company);
      await addLead({
        email: contact.email,
        ...nameFromEmail(contact.email),
        company_name: contact.company,
        website: `https://${contact.domain}`,
        custom_fields: { opening_line: line, target_page: pageUrl(t.our_page), topic: t.method },
      });
      await prisma.backlink_tasks.update({ where: { id: t.id }, data: { status: 'sent', contact_email: contact.email, email_body: line, sent_at: sqlNow(now), note: 'Added to Smartlead campaign.' } });
      await activity.log('backlink.sent', { entityType: 'backlink_task', entityId: t.id, details: `Added ${contact.email} (${t.target_site}) to the Smartlead campaign` });
      out.pushed++;
      budget--;
    } catch (err: any) {
      await activity.log('backlink.failed', { entityType: 'backlink_task', entityId: t.id, details: String(err.message || err).slice(0, 500) });
    }
  }
  return out;
}

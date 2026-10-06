// @ts-nocheck -- reads untyped WordPress JSON.
// Applies the technical fixes ticked in the approved strategy, through the WordPress REST API.
// Every change saves the old value in site_changes first, so it can be undone.
//  - Missing or duplicate title, missing meta description: Claude writes a new one (Yoast fields).
//  - Broken link inside a page: the link is removed and its text kept.
//  - A URL returning 4xx: a 301 redirect to the closest live page (needs the Redirection plugin).
//  - Thin content: an FAQ built only from what the page already says is added before the end.
//  - Anything else (speed, theme, server, code): cannot be changed safely from here; marked manual.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { wpRequest, refreshYoast } from '../wordpress';
import { callClaude } from '../anthropic';

export function fixKind(issue: string): string {
  if (/^Broken link to /i.test(issue)) return 'broken_link';
  if (/\b4\d\d status code/i.test(issue)) return 'redirect';
  if (/missing title|duplicate title/i.test(issue)) return 'title';
  if (/meta description/i.test(issue)) return 'meta';
  if (/thin content/i.test(issue)) return 'thin';
  return 'manual';
}

// Removes every <a> pointing at `target`, keeping the visible text.
export function unwrapLinks(html: string, target: string): string {
  const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '');
  return html.replace(new RegExp(`<a\\b[^>]*href=["']${esc}/?["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi'), '$1');
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
const slugOf = (url: string) => pathOf(url).replace(/\/+$/, '').split('/').pop() || '';

// The WordPress post or page behind a URL.
async function findItem(url: string) {
  const slug = slugOf(url);
  if (!slug) return null;
  for (const type of ['posts', 'pages']) {
    const { json } = await wpRequest('GET', `/wp/v2/${type}`, { query: { slug, context: 'edit', status: 'publish', _fields: 'id,link,title,content,meta' } });
    if (json?.length) return { type, item: json[0] };
  }
  return null;
}

async function saveUndo(summary: string, type: string, id: number, undo: any) {
  await prisma.site_changes.create({ data: { tool: 'technical_fix', summary, target_type: type, target_id: String(id), undo: JSON.stringify(undo) } });
}

async function writeText(kind: 'title' | 'meta', page: any) {
  const plain = String(page.content?.raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
  const rule = kind === 'title' ? 'an SEO title under 60 characters, unique to this page' : 'a meta description of 140 to 155 characters';
  const { text } = await callClaude(
    `You write ${rule} for a page on usaindiacfo.com (cross-border CFO, tax and compliance for US and India). Use only what the page says. No em dashes, no quotes. Return only the text.`,
    [{ role: 'user', content: `Page title: ${page.title?.raw || ''}\n\nPage text:\n${plain}` }],
    undefined,
    { maxUses: 1, effort: 'low', feature: 'technical_fix' }
  );
  return text.trim().replace(/^["']|["']$/g, '').replace(/—/g, ',');
}

async function addFaq(page: any) {
  const raw = String(page.content?.raw || '');
  const { text } = await callClaude(
    `You add a short FAQ section to an existing page on usaindiacfo.com. Write 3 to 4 questions a reader would ask, each answered in 2 or 3 sentences, using ONLY facts already stated in the page. Never add a new number, date, rate or rule. No em dashes. Return only HTML: <h2>Frequently asked questions</h2> then <h3>question</h3><p>answer</p> pairs.`,
    [{ role: 'user', content: raw.slice(0, 30000) }],
    undefined,
    { maxUses: 1, effort: 'medium', feature: 'technical_fix' }
  );
  const faq = text.slice(text.indexOf('<h2')).trim();
  if (!faq.startsWith('<h2')) throw new Error('Claude did not return an FAQ section');
  return `${raw}\n${faq}\n`;
}

async function closestLivePage(url: string) {
  const words = slugOf(url).split('-').filter((w) => w.length > 3).slice(0, 4).join(' ');
  if (words) {
    const { json } = await wpRequest('GET', '/wp/v2/search', { query: { search: words, per_page: 1 } });
    if (json?.[0]?.url && json[0].url !== url) return json[0].url;
  }
  return (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '') + '/';
}

export async function applyFix(task: any): Promise<{ status: 'applied' | 'manual' | 'failed'; result: string }> {
  const kind = task.kind;
  if (kind === 'manual') return { status: 'manual', result: 'Needs a developer (speed, theme, server or code). The dashboard does not change these.' };

  if (kind === 'redirect') {
    const to = await closestLivePage(task.url);
    const res = await wpRequest('POST', '/redirection/v1/redirect', {
      body: { url: pathOf(task.url), action_data: { url: to }, action_type: 'url', action_code: 301, match_type: 'url', group_id: 1 },
    }).catch(() => null);
    const json = res?.json;
    if (!json || typeof json !== 'object') return { status: 'manual', result: 'Redirect not created: install and activate the free "Redirection" plugin in WordPress, then this fix runs again.' };
    await saveUndo(`301 ${task.url} -> ${to}`, 'redirect', json?.items?.[0]?.id || 0, { redirectFrom: pathOf(task.url) });
    return { status: 'applied', result: `301 redirect to ${to}` };
  }

  const found = await findItem(task.url);
  if (!found) return { status: 'manual', result: 'Page not found in WordPress (it may be a category, tag or theme page).' };
  const { type, item } = found;
  const route = `/wp/v2/${type}/${item.id}`;

  if (kind === 'broken_link') {
    const target = task.issue.replace(/^Broken link to /i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const raw = String(item.content?.raw || '');
    const next = unwrapLinks(raw, target);
    if (next === raw) return { status: 'manual', result: 'The link is in the menu, sidebar or footer, not in the page text. Remove it in Appearance > Menus or Widgets.' };
    await saveUndo(`Removed broken link to ${target} on ${task.url}`, type, item.id, { content: raw });
    await wpRequest('POST', route, { body: { content: next } });
    return { status: 'applied', result: `Removed the broken link to ${target} (text kept)` };
  }

  if (kind === 'title' || kind === 'meta') {
    const value = await writeText(kind, item);
    const key = kind === 'title' ? '_yoast_wpseo_title' : '_yoast_wpseo_metadesc';
    await saveUndo(`${kind === 'title' ? 'SEO title' : 'Meta description'} on ${task.url}`, type, item.id, { meta: { [key]: item.meta?.[key] ?? '' } });
    await wpRequest('POST', route, { body: { meta: { [key]: value } } });
    await refreshYoast(type === 'pages' ? 'page' : 'post', item.id);
    return { status: 'applied', result: `${kind === 'title' ? 'SEO title' : 'Meta description'} set: ${value}` };
  }

  if (kind === 'thin') {
    const raw = String(item.content?.raw || '');
    if (/frequently asked questions/i.test(raw)) return { status: 'manual', result: 'The page already has an FAQ; it needs a fuller rewrite (add it to the blog refresh list).' };
    const next = await addFaq(item);
    await saveUndo(`Added FAQ to thin page ${task.url}`, type, item.id, { content: raw });
    await wpRequest('POST', route, { body: { content: next } });
    return { status: 'applied', result: 'Added an FAQ built from the page text' };
  }
  return { status: 'manual', result: 'Unknown fix type' };
}

// Runs a few planned fixes per scheduler run, so the site is never changed in one big burst.
export async function runFixes({ max = 5 } = {}) {
  const out = { applied: 0, manual: 0, failed: 0 };
  const tasks = await prisma.technical_fix_tasks.findMany({ where: { status: 'planned' }, orderBy: { id: 'asc' }, take: max });
  for (const t of tasks) {
    let r;
    try {
      r = await applyFix(t);
    } catch (e: any) {
      r = { status: 'failed', result: String(e.message || e).slice(0, 500) };
    }
    await prisma.technical_fix_tasks.update({ where: { id: t.id }, data: { status: r.status, result: r.result, applied_at: sqlNow() } });
    await activity.log(`technical_fix.${r.status}`, { entityType: 'technical_fix', entityId: t.id, details: `${t.url}: ${t.issue}. ${r.result}` });
    out[r.status]++;
  }
  return out;
}

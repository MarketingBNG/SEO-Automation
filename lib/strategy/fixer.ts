// Applies the technical fixes ticked in the approved strategy, through the website connector.
// Every change saves the old value in site_changes first, so it can be undone.
//  - Missing or duplicate title, missing meta description: Claude writes a new one (the post's SEO fields).
//  - Broken link inside a post: the link is removed and its text kept.
//  - Thin content: an FAQ built only from what the post already says is added before the end.
//  - A URL returning 4xx (needs a 301 redirect), pages that are not blog posts, and anything else
//    (speed, theme, server, code): cannot be changed from here; marked manual for a developer.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { postBySlug, searchPosts, updatePost, siteConfigured, SITE_NOT_SET_UP, type Post } from '../site';
import { publicSite } from '../siteConnector';
import { callClaude } from '../anthropic';
import { notify } from '../notify';

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

// The blog post on the website behind a URL (pages and theme parts are not reachable from here).
async function findPost(url: string): Promise<Post | null> {
  const slug = slugOf(url);
  if (!slug) return null;
  const p = await postBySlug(slug);
  return p && p.id && p.status === 'publish' ? p : null;
}

// Saved before each change; Undo in the dashboard puts these fields back (lib/assistant/tools.ts).
async function saveUndo(summary: string, post: Post, fields: Record<string, any>) {
  await prisma.site_changes.create({ data: { tool: 'technical_fix', summary, target_type: 'post', target_id: String(post.id), undo: JSON.stringify({ kind: 'restore_site_post', id: post.id, fields }) } });
}

async function writeText(kind: 'title' | 'meta', page: Post) {
  const plain = String(page.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
  const rule = kind === 'title' ? 'an SEO title under 60 characters, unique to this page' : 'a meta description of 140 to 155 characters';
  const { text } = await callClaude(
    `You write ${rule} for a page on usaindiacfo.com (cross-border CFO, tax and compliance for US and India). Use only what the page says. No em dashes, no quotes. Return only the text.`,
    [{ role: 'user', content: `Page title: ${page.title || ''}\n\nPage text:\n${plain}` }],
    undefined,
    { maxUses: 1, effort: 'low', feature: 'technical_fix' }
  );
  return text.trim().replace(/^["']|["']$/g, '').replace(/—/g, ',');
}

async function addFaq(page: Post) {
  const raw = String(page.content || '');
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

// The closest live post to a dead URL (by the words in its address), else the home page.
async function closestLivePage(url: string) {
  const words = slugOf(url).split('-').filter((w) => w.length > 3).slice(0, 4).join(' ');
  const hit = words ? (await searchPosts(words, 1, { full: false }).catch(() => []))[0] : null;
  return hit && hit.link !== url ? hit.link : `${publicSite()}/`;
}

export async function applyFix(task: any): Promise<{ status: 'applied' | 'manual' | 'failed'; result: string }> {
  const kind = task.kind;
  if (kind === 'manual') return { status: 'manual', result: 'Needs a developer (speed, theme, server or code). The dashboard does not change these.' };

  if (kind === 'redirect') {
    const to = await closestLivePage(task.url);
    return { status: 'manual', result: `Needs a developer: add a 301 redirect on the website from ${pathOf(task.url)} to ${to}. The dashboard cannot create redirects.` };
  }

  const post = await findPost(task.url);
  if (!post) return { status: 'manual', result: 'Not a live blog post on the website (it may be a page, category or theme part): a developer must change it.' };

  if (kind === 'broken_link') {
    const target = task.issue.replace(/^Broken link to /i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const raw = String(post.content || '');
    const next = unwrapLinks(raw, target);
    if (next === raw) return { status: 'manual', result: 'The link is in the menu, sidebar or footer, not in the post text. A developer must remove it from the website template.' };
    await saveUndo(`Removed broken link to ${target} on ${task.url}`, post, { contentHtml: raw });
    await updatePost(post.id as number, { contentHtml: next });
    return { status: 'applied', result: `Removed the broken link to ${target} (text kept)` };
  }

  if (kind === 'title' || kind === 'meta') {
    const value = await writeText(kind, post);
    if (kind === 'title') {
      await saveUndo(`SEO title on ${task.url}`, post, { seoTitle: post.seoTitle || post.title });
      await updatePost(post.id as number, { seoTitle: value });
    } else {
      await saveUndo(`Meta description on ${task.url}`, post, { metaDescription: post.seoDescription || '' });
      await updatePost(post.id as number, { metaDescription: value });
    }
    return { status: 'applied', result: `${kind === 'title' ? 'SEO title' : 'Meta description'} set: ${value}` };
  }

  if (kind === 'thin') {
    const raw = String(post.content || '');
    if (/frequently asked questions/i.test(raw)) return { status: 'manual', result: 'The page already has an FAQ; it needs a fuller rewrite (add it to the blog refresh list).' };
    const next = await addFaq(post);
    await saveUndo(`Added FAQ to thin page ${task.url}`, post, { contentHtml: raw });
    await updatePost(post.id as number, { contentHtml: next });
    return { status: 'applied', result: 'Added an FAQ built from the page text' };
  }
  return { status: 'manual', result: 'Unknown fix type' };
}

// At most this many fixes a day (env TECH_FIX_DAILY_LIMIT), so the site changes gradually and the
// AI cost is spread over the month instead of landing on one day.
export const FIX_DAILY_LIMIT = () => Number(process.env.TECH_FIX_DAILY_LIMIT || 20);

// Runs a few planned fixes per scheduler run, so the site is never changed in one big burst.
export async function runFixes({ max = 5, now = new Date() } = {}) {
  const out: Record<string, any> = { applied: 0, manual: 0, failed: 0 };
  // Without the website connection the planned fixes wait (they are not marked failed).
  if (!siteConfigured()) return { ...out, skipped: SITE_NOT_SET_UP };
  const done: string[] = [];
  const today = now.toISOString().slice(0, 10);
  const doneToday = await prisma.technical_fix_tasks.count({ where: { strategy_id: { not: 0 }, applied_at: { startsWith: today } } });
  const take = Math.max(0, Math.min(max, FIX_DAILY_LIMIT() - doneToday));
  if (!take) return out;
  const tasks = await prisma.technical_fix_tasks.findMany({ where: { status: 'planned' }, orderBy: { id: 'asc' }, take });
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
    done.push(`${r.status === 'applied' ? 'Done' : r.status === 'manual' ? 'Needs a person' : 'Failed'}: ${t.url} (${t.issue}). ${r.result}`);
  }
  // Send the results so nobody has to open the Activity Log to check the live site.
  if (done.length) await notify(`Technical fixes: ${out.applied} applied, ${out.manual} need a person, ${out.failed} failed`, done.join('\n')).catch(() => {});
  return out;
}

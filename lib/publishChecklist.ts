// The publish checklist: before a blog is published or approved for publishing (Drafts & Review,
// Post my blog, the calendar's Approve and Publish now, and the assistant's tools for them), a person
// ticks Author, Title, Blog text and Banner, each checked against what is shown. A tick is saved with
// a fingerprint of what it checked, so changing the title, author, text or banner afterwards undoes
// that tick by itself. The calendar's own publishing at the slot uses the approval already given
// and does not ask again. Who ticked and when is saved and logged.
// The banner is settled before it can be ticked (settleBanner: the photo banner, or the branded cover
// when no photo can be made, saved on the draft), so the banner that is ticked is the file that is
// published; nothing makes a different banner after the tick.
import crypto from 'crypto';
import prismaClient from './prisma';
import * as activity from './activity';
import { sqlNow } from './time';

// Untyped on purpose: the Prisma query types of these many queries push the build's type check past
// its memory limit (see lib/assistant/tabTools.ts). The tests cover the queries.
const prisma: any = prismaClient;

export const CHECK_ITEMS = ['author', 'title', 'content', 'banner'] as const;
export type CheckItem = (typeof CHECK_ITEMS)[number];
export type Ticks = Partial<Record<CheckItem, boolean>>;
export const CHECK_LABEL: Record<CheckItem, string> = { author: 'Author checked', title: 'Title checked', content: 'Blog text checked', banner: 'Banner checked' };

const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
type DraftLike = { id: number; title: string | null; author: string | null; content_html: string | null; featured_image_path: string | null; cover_alt?: string | null; publish_checklist?: string | null; status?: string | null; kind?: string | null };

// A refresh of a live page keeps that page's own cover: there is no banner of ours to check.
async function isRefresh(id: number) {
  return Boolean(await prisma.blog_schedule.findFirst({ where: { draft_id: id, refresh_url: { not: null } }, select: { id: true } }));
}

// The banner the blog will carry, made now if it has none: the photo banner (as before, the same
// one publishing used to make), else the branded cover from the title and author. Saved on the draft,
// so the file shown at the tick is the file published. null for a refresh or a LinkedIn article.
export async function settleBanner(draftId: number): Promise<string | null> {
  const d = await prisma.drafts.findUnique({ where: { id: draftId } });
  if (!d || d.kind === 'article' || (await isRefresh(draftId))) return null;
  if (d.featured_image_path) return d.featured_image_path;
  const { ensurePhotoCover } = await import('./coverPhoto');
  const photo = await ensurePhotoCover(draftId).catch(() => null);
  if (photo) return photo;
  const { makeCover } = await import('./cover');
  const { saveFile } = await import('./storage');
  const author = await authorOf(d);
  const key = await saveFile(`covers/${Date.now()}-draft-${draftId}.png`, await makeCover(d.title || 'USAIndiaCFO', author || null), 'image/png').catch(() => null);
  if (!key) return null;
  await prisma.drafts.updateMany({ where: { id: draftId, featured_image_path: null }, data: { featured_image_path: key } });
  return (await prisma.drafts.findUnique({ where: { id: draftId }, select: { featured_image_path: true } }))?.featured_image_path || null;
}

// The author the blog goes out under: the draft's, else its calendar row's.
async function authorOf(d: DraftLike) {
  if (d.author) return d.author;
  const row = await prisma.blog_schedule.findFirst({ where: { draft_id: d.id }, orderBy: { id: 'desc' }, select: { author: true } });
  return row?.author || '';
}

// What each tick vouches for. The banner is the saved file (and its alt text); a draft with no banner
// file yet has nothing to tick.
export async function fingerprints(d: DraftLike): Promise<Record<CheckItem, string>> {
  const author = await authorOf(d);
  const refresh = await isRefresh(d.id);
  return {
    author: sha(author),
    title: sha(String(d.title || '')),
    content: sha(String(d.content_html || '')),
    banner: sha(refresh ? 'the live page keeps its cover' : d.featured_image_path ? `file:${d.featured_image_path}|${d.cover_alt || ''}` : 'none'),
  };
}

type Saved = Partial<Record<CheckItem, { fp: string; by: string; at: string }>>;
const savedOf = (d: DraftLike): Saved => {
  try {
    return JSON.parse(d.publish_checklist || '{}') || {};
  } catch {
    return {};
  }
};

// Each item: ticked (still valid for what the blog holds now), by whom and when, and what it shows.
export async function checklistState(d: DraftLike) {
  const fp = await fingerprints(d);
  const saved = savedOf(d);
  const author = await authorOf(d);
  const items = CHECK_ITEMS.map((k) => ({
    key: k,
    label: CHECK_LABEL[k],
    ticked: saved[k]?.fp === fp[k],
    // A tick made before a change: shown as reset, so the person knows why.
    reset: Boolean(saved[k]) && saved[k]!.fp !== fp[k],
    by: saved[k]?.fp === fp[k] ? saved[k]!.by : null,
    at: saved[k]?.fp === fp[k] ? saved[k]!.at : null,
  }));
  const refresh = await isRefresh(d.id);
  return {
    items,
    complete: items.every((i) => i.ticked),
    values: {
      author: author || null,
      // Live with no author: the website shows its default author, which is what is checked.
      live: d.status === 'published',
      title: d.title || '',
      words: String(d.content_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
      banner: refresh ? 'the live page keeps its own cover' : d.featured_image_path ? 'the banner shown here' : 'no banner yet',
      bannerReady: refresh || Boolean(d.featured_image_path),
    },
  };
}

// Saves ticks (true) and removes them (false) for what the blog holds now.
export async function setTicks(draftId: number, ticks: Ticks, actor: string) {
  if (!(await prisma.drafts.findUnique({ where: { id: draftId }, select: { id: true } }))) throw Object.assign(new Error('Draft not found'), { status: 404 });
  // The banner is settled before it is ticked, so the tick is for the file that will be published.
  if (ticks.banner === true && !(await settleBanner(draftId)) && !(await isRefresh(draftId))) {
    const k = await prisma.drafts.findUnique({ where: { id: draftId }, select: { kind: true } });
    if (k?.kind !== 'article') throw Object.assign(new Error('No banner could be made for this blog. Upload a cover, then tick Banner checked.'), { status: 409 });
  }
  const d = await prisma.drafts.findUnique({ where: { id: draftId } });
  const fp = await fingerprints(d);
  const saved = savedOf(d);
  const at = sqlNow();
  const changed: string[] = [];
  for (const k of CHECK_ITEMS) {
    if (ticks[k] === true) {
      saved[k] = { fp: fp[k], by: actor, at };
      changed.push(`${CHECK_LABEL[k]}: yes`);
    } else if (ticks[k] === false && saved[k]) {
      delete saved[k];
      changed.push(`${CHECK_LABEL[k]}: no`);
    }
  }
  await prisma.drafts.update({ where: { id: draftId }, data: { publish_checklist: JSON.stringify(saved) } });
  if (changed.length) await activity.log('draft.checklist', { entityType: 'draft', entityId: draftId, details: `"${d.title}": ${changed.join(', ')}`, actor });
  return checklistState({ ...d, publish_checklist: JSON.stringify(saved) });
}

export const allTicked = (t: any): boolean => !!t && typeof t === 'object' && CHECK_ITEMS.every((k) => t[k] === true);

// The refusal when the checklist is not complete for what the blog holds now, or null. Ticks sent
// with the request (Post my blog, the assistant's card, a calendar button) are saved first, under the
// person's name, so they count.
export async function checklistProblem(draftId: number, sent: any, actor: string): Promise<string | null> {
  if (allTicked(sent)) {
    await setTicks(draftId, sent, actor);
    return null;
  }
  const d = await prisma.drafts.findUnique({ where: { id: draftId } });
  if (!d) return 'Draft not found.';
  const state = await checklistState(d);
  if (state.complete) return null;
  const missing = state.items.filter((i) => !i.ticked);
  const reset = missing.filter((i) => i.reset).map((i) => i.label.replace(' checked', '').toLowerCase());
  return `Tick the publish checklist first: ${missing.map((i) => i.label).join(', ')}.${reset.length ? ` (The ${reset.join(', ')} changed after it was ticked, so it must be checked again.)` : ''}`;
}

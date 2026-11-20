// Changes to a blog that is LIVE on the website, made through the website connector (lib/site.ts):
// the author (one of the blog authors; the byline and article schema follow, as publishing builds
// them) and the words (exact text replacements, the title, the meta description, or one section
// under a heading). The post's address, cover and (for word edits) author never change. Reviewer
// placeholders and AI notes are refused, as publishing refuses them. Each change is recorded in the
// content changes and the activity log, and can be undone while nobody has changed the post since.
// Used by the assistant's live_blog_set_author / live_blog_edit tools and by Drafts & Review
// ("Change author on the live post").
import prisma from './prisma';
import * as activity from './activity';
import { getPost, findPostByUrl, updatePost, postFieldsHash, type Post } from './site';
import { slugFromUrl, authorSlug } from './siteConnector';
import { withAuthor } from './byline';
import { authorNames } from './authors';
import { liveTextProblem } from './publishDraft';
import { diffContent } from './contentDiff';
import { recordChange } from './contentChanges';
import { sqlNow } from './time';

export type PostRef = { post_id?: number; url?: string };
export type LiveChange = { summary: string; targetType: string; targetId: string; undo: any };

const plain = (h: string) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const snippet = (s: string, n = 120) => {
  const t = plain(s) || String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// The live post the person means: by its dashboard id (website_search_posts) or its address.
export async function livePost(ref: PostRef): Promise<Post> {
  let p: Post | null = null;
  if (ref.post_id) p = await getPost(ref.post_id);
  else if (ref.url) p = await findPostByUrl(ref.url);
  if (!p) throw Object.assign(new Error('Give the post (post_id from website_search_posts, or its url).'), { status: 400 });
  if (p.status !== 'publish') throw Object.assign(new Error(`/${p.slug}/ is not live on the website.`), { status: 409 });
  return p;
}

// The Drafts & Review blog this post came from, if any.
export async function draftOfPost(p: Post) {
  return (
    (p.id ? await prisma.drafts.findFirst({ where: { wp_post_id: p.id }, orderBy: { id: 'desc' } }) : null) ||
    (await prisma.drafts.findMany({ where: { wp_post_url: { contains: p.slug } }, orderBy: { id: 'desc' }, take: 5 })).find((d) => d.wp_post_url && slugFromUrl(d.wp_post_url) === p.slug) ||
    null
  );
}

// Text that must never be put on the live page by an edit (scripts, inline handlers, embeds).
const ACTIVE = /<\s*(script|iframe|object|embed|form|style)\b|\son[a-z]+\s*=|javascript:/i;

// ---------------------------------------------------------------- author

export async function authorPlan(ref: PostRef, author: string) {
  const names = await authorNames();
  const name = names.find((n) => n.toLowerCase() === String(author || '').trim().toLowerCase());
  if (!name) throw Object.assign(new Error(`Pick one of the blog authors: ${names.join(', ')}.`), { status: 400 });
  if (!authorSlug(name)) throw Object.assign(new Error(`The website does not know "${name}" as an author yet. Ask the website developer to add the author, then try again.`), { status: 400 });
  const post = await livePost(ref);
  const html = withAuthor(post.content, name, post.title);
  const draft = await draftOfPost(post);
  return { post, name, html, draft, same: authorSlug(name) === post.author && html === post.content };
}

export async function setLiveAuthor(ref: PostRef, author: string, actor: string): Promise<{ result: any; change: LiveChange }> {
  const plan = await authorPlan(ref, author);
  const { post, name, html, draft } = plan;
  if (plan.same) throw Object.assign(new Error(`"${post.title}" is already published under ${name}.`), { status: 409 });
  const updated = await updatePost(post.id!, { contentHtml: html, authorName: name });
  if (draft) await prisma.drafts.update({ where: { id: draft.id }, data: { author: name, updated_at: sqlNow() } });
  await recordChange({ entityType: draft ? 'draft' : 'post', entityId: draft ? draft.id : post.id!, kind: 'author', actor, title: post.title, before: { title: post.title, html: post.content }, after: { title: post.title, html: updated.content } }).catch(() => null);
  await activity.log('site.author_changed', { entityType: draft ? 'draft' : 'site_post', entityId: draft ? draft.id : post.id, details: `"${post.title}" (${post.link}): author ${post.author || 'none'} to ${name}`, actor });
  return {
    result: { post_id: post.id, url: updated.link, author: name, draft_id: draft?.id ?? null, note: 'Live now. The byline and the article schema name the new author; the address and cover are unchanged.' },
    change: {
      summary: `Changed the author of the live post "${post.title}" to ${name}`,
      targetType: 'site_post',
      targetId: String(post.id),
      undo: { kind: 'restore_live_post', id: post.id, fields: { contentHtml: post.content, authorName: post.author }, expectHash: postFieldsHash(updated, ['contentHtml', 'authorName']), draftId: draft?.id ?? null, draftAuthor: draft?.author ?? null, title: post.title },
    },
  };
}

// ---------------------------------------------------------------- words

export type LiveEdit = { edits?: { find: string; replace: string; replace_all?: boolean }[]; title?: string; meta_description?: string; section?: { heading: string; html: string } };

// Replaces the section that starts at the heading with this text (h2 to h4, matched on its words)
// up to the next heading of the same or a higher level (or the schema at the end).
export function replaceSection(html: string, heading: string, replacement: string): { html: string; problem: string | null; before: string } {
  const want = plain(heading).toLowerCase();
  const re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const hits: { at: number; level: number }[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) if (plain(m[2]).toLowerCase() === want) hits.push({ at: m.index, level: Number(m[1]) });
  if (!hits.length) return { html, problem: `No heading "${heading}" in the post. Copy the heading's words exactly.`, before: '' };
  if (hits.length > 1) return { html, problem: `The heading "${heading}" appears ${hits.length} times; use exact text edits instead.`, before: '' };
  const { at, level } = hits[0];
  const rest = html.slice(at + 1);
  const stop = rest.search(new RegExp(`<h[1-${level}]\\b|<script\\b`, 'i'));
  const end = stop < 0 ? html.length : at + 1 + stop;
  return { html: html.slice(0, at) + replacement + html.slice(end), problem: null, before: html.slice(at, end) };
}

export async function editPlan(ref: PostRef, e: LiveEdit) {
  const post = await livePost(ref);
  let html = post.content;
  const problems: string[] = [];
  const changes: { field: string; before: string; after: string }[] = [];
  (e.edits || []).forEach((x, k) => {
    if (!x.find) return problems.push(`Change ${k + 1}: "find" is empty.`);
    const n = html.split(x.find).length - 1;
    if (n === 0) return problems.push(`Change ${k + 1}: the text was not found in the live post. Copy it exactly from website_get_post (tags included): "${snippet(x.find, 80)}"`);
    if (n > 1 && !x.replace_all) return problems.push(`Change ${k + 1}: the text appears ${n} times; use a longer unique snippet or replace_all.`);
    changes.push({ field: `Change ${k + 1}${n > 1 ? ` (${n} places)` : ''}`, before: snippet(x.find), after: snippet(x.replace) || '(removed)' });
    html = x.replace_all ? html.split(x.find).join(x.replace) : html.replace(x.find, () => x.replace);
  });
  if (e.section) {
    const r = replaceSection(html, e.section.heading, e.section.html);
    if (r.problem) problems.push(r.problem);
    else {
      changes.push({ field: `Section "${e.section.heading}"`, before: snippet(r.before, 200), after: snippet(e.section.html, 200) });
      html = r.html;
    }
  }
  const title = e.title !== undefined ? String(e.title).trim() : post.title;
  const meta = e.meta_description !== undefined ? String(e.meta_description).trim() : post.seoDescription || '';
  if (e.title !== undefined) {
    if (!title) problems.push('The title cannot be empty.');
    changes.push({ field: 'title', before: post.title, after: title });
  }
  if (e.meta_description !== undefined) changes.push({ field: 'meta description', before: post.seoDescription || '', after: meta });
  if (!changes.length && !problems.length) problems.push('Nothing to change: give edits, a title, a meta description or a section.');
  const added = [...(e.edits || []).map((x) => x.replace), e.section?.html || '', e.title || '', e.meta_description || ''].join(' ');
  if (ACTIVE.test(added)) problems.push('The new text has a script, embed, form or event handler, which is not allowed on the live page.');
  const live = liveTextProblem({ title, meta_description: meta, content_html: html });
  if (live) problems.push(live.replace('before publishing', 'before it goes on the live post'));
  const report = diffContent({ title: post.title, meta: post.seoDescription, html: post.content }, { title, meta, html });
  return { post, html, title, meta, changes, problems, report, draft: await draftOfPost(post) };
}

export async function editLive(ref: PostRef, e: LiveEdit, actor: string): Promise<{ result: any; change: LiveChange }> {
  const plan = await editPlan(ref, e);
  const { post, html, title, meta, draft } = plan;
  if (plan.problems.length) throw Object.assign(new Error(`${plan.problems.join(' ')} Nothing was changed on the website.`), { status: 400 });
  // Only what was asked: the address, cover and author are sent as they are (updatePost keeps them).
  const fields: Record<string, any> = {};
  const before: Record<string, any> = {};
  if (html !== post.content) {
    fields.contentHtml = html;
    before.contentHtml = post.content;
  }
  if (e.title !== undefined && title !== post.title) {
    fields.title = title;
    before.title = post.title;
    // The SEO title follows the title only where it was the title.
    if (!post.seoTitle || post.seoTitle === post.title) {
      fields.seoTitle = title;
      before.seoTitle = post.seoTitle || post.title;
    }
  }
  if (e.meta_description !== undefined && meta !== (post.seoDescription || '')) {
    fields.metaDescription = meta;
    before.metaDescription = post.seoDescription;
    if (!post.excerpt || post.excerpt === post.seoDescription) {
      fields.excerpt = meta;
      before.excerpt = post.excerpt || '';
    }
  }
  if (!Object.keys(fields).length) throw Object.assign(new Error('The post already says that; nothing was changed.'), { status: 409 });
  const updated = await updatePost(post.id!, fields);
  // The dashboard copy keeps the same title and meta description (its article text is the draft's own).
  if (draft && (fields.title || fields.metaDescription)) {
    await prisma.drafts.update({ where: { id: draft.id }, data: { ...(fields.title ? { title } : {}), ...(fields.metaDescription ? { meta_description: meta } : {}), updated_at: sqlNow() } });
  }
  await recordChange({ entityType: draft ? 'draft' : 'post', entityId: draft ? draft.id : post.id!, kind: 'live_edit', actor, title, before: { title: post.title, meta: post.seoDescription, html: post.content }, after: { title: updated.title, meta: updated.seoDescription, html: updated.content } }).catch(() => null);
  await activity.log('site.live_edit', { entityType: draft ? 'draft' : 'site_post', entityId: draft ? draft.id : post.id, details: `"${post.title}" (${post.link}): ${plan.report.summary}`.slice(0, 1000), actor });
  return {
    result: {
      post_id: post.id,
      url: updated.link,
      changed: Object.keys(fields),
      summary: plan.report.summary,
      note: draft ? `Live now. Drafts & Review #${draft.id} keeps its own article text: publishing that draft again ("Update the live post") would replace these word changes.` : 'Live now.',
    },
    change: {
      summary: `Edited the live post "${post.title}": ${plan.report.summary}`.slice(0, 500),
      targetType: 'site_post',
      targetId: String(post.id),
      undo: { kind: 'restore_live_post', id: post.id, fields: before, expectHash: postFieldsHash(updated, Object.keys(before)), draftId: draft?.id ?? null, title: post.title, ...(fields.title || fields.metaDescription ? { draftFields: { title: draft?.title ?? null, meta_description: draft?.meta_description ?? null } } : {}) },
    },
  };
}

// Undo: the saved fields go back, unless the post changed on the website since (then it is refused,
// as restore_site_post is, so later changes are not lost).
export async function undoLiveChange(undo: any, { force = false, actor = 'someone' }: { force?: boolean; actor?: string } = {}) {
  const current = await getPost(undo.id);
  if (undo.expectHash && !force && postFieldsHash(current, Object.keys(undo.fields || {})) !== undo.expectHash) {
    const err: any = new Error('This post was changed on the website after this change. Undoing now would also remove those later changes.');
    err.code = 'CHANGED_SINCE';
    throw err;
  }
  const restored = await updatePost(undo.id, undo.fields || {});
  if (undo.draftId) {
    const data: any = {};
    if ('authorName' in (undo.fields || {}) && undo.draftAuthor !== undefined) data.author = undo.draftAuthor;
    if (undo.draftFields) {
      if (undo.fields.title !== undefined && undo.draftFields.title !== null) data.title = undo.draftFields.title;
      if (undo.fields.metaDescription !== undefined && undo.draftFields.meta_description !== null) data.meta_description = undo.draftFields.meta_description;
    }
    if (Object.keys(data).length) await prisma.drafts.update({ where: { id: undo.draftId }, data: { ...data, updated_at: sqlNow() } }).catch(() => {});
  }
  await recordChange({ entityType: undo.draftId ? 'draft' : 'post', entityId: undo.draftId || undo.id, kind: 'restore', actor, title: undo.title || current.title, before: { title: current.title, meta: current.seoDescription, html: current.content }, after: { title: restored.title, meta: restored.seoDescription, html: restored.content } }).catch(() => null);
  return 'Restored the previous version of the live post.';
}

// Drafts & Review: saving a draft's words, approving or rejecting it, setting its author or cover alt
// text, and deleting it. Shared by PATCH and DELETE /api/drafts/[id] and the assistant's draft tools,
// so every path runs the same checks. Each returns { status, body } exactly as the route answers.
import prisma from '@/lib/prisma';
import { markEditedAsChecked, wordsHash } from '@/lib/factCheckMark';
import * as activity from '@/lib/activity';
import { sqlNow } from '@/lib/time';
import { needsExpertReview, publishPlan } from '@/lib/strategy/core';
import { requireExpert } from '@/lib/reviewers';
import { DRAFT_TOKEN_ACTOR } from '@/lib/draftToken';
import { stripActiveContent } from '@/lib/htmlSanitize';
import { authorNames, pickAuthor } from '@/lib/authors';
import { requeueAfterDelete } from '@/lib/draftDelete';
import { linkLiveTopic } from '@/lib/topics';
import { recordChange } from '@/lib/contentChanges';

type Result = { status: number; body: any };

// input: { title, meta_description, content_html, status, cover_alt, author, if_updated_at, if_text_hash, change_source }
// viaToken: the request came with the Claude Code edit token (scripts/draft.ts), which changes words
// only; actor is then DRAFT_TOKEN_ACTOR.
export async function patchDraft(nid: number, input: any, { actor, viaToken = false }: { actor: string; viaToken?: boolean }): Promise<Result> {
  const { title, meta_description, content_html, status, cover_alt, author, if_updated_at, if_text_hash, change_source }: any = input || {};
  const existing = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return { status: 404, body: { error: 'Not found' } };
  // Claude Code edits words only; approving, rejecting and publishing stay with a signed-in person.
  if (viaToken && (status != null || cover_alt != null || author != null)) return { status: 403, body: { error: 'The edit token changes only the title, meta description and article. Approve or reject in the dashboard.' } };
  // Only the review states the screen sets. 'published' comes only from a real publish (it needs the
  // website post), and a blog already live is not moved back to review here.
  if (status != null && !['approved', 'rejected', 'pending_review'].includes(status)) {
    return { status: 400, body: { error: 'Status must be approved, rejected or pending_review. Publishing is done with Publish.' } };
  }
  if (status != null && existing.status === 'published') {
    return { status: 409, body: { error: 'This blog is already published; its review status cannot change here.' } };
  }
  // Sent by scripts/draft.ts: refuse when someone saved the draft after it was read.
  const changedMeanwhile = { error: `The draft was changed at ${existing.updated_at} (after it was read). Read it again and redo the edit.` };
  if (if_updated_at != null && String(if_updated_at) !== String(existing.updated_at)) return { status: 409, body: changedMeanwhile };
  // Sent by the Drafts editor: refuse only when the words changed after the boxes were loaded (a new
  // cover or a status change meanwhile is not a conflict).
  if (if_text_hash != null && String(if_text_hash) !== wordsHash(existing)) return { status: 409, body: changedMeanwhile };

  // The partner the blog is published under: one of the names in the list, or "random" for a new
  // random pick. Set on the draft and on its calendar row, which both publish routes read.
  if (author != null) {
    const names = await authorNames();
    const name = author === 'random' ? pickAuthor(names) : names.find((n) => n === author);
    if (!name) return { status: 400, body: { error: `Pick one of: ${names.join(', ')}.` } };
    if (existing.wp_post_url) return { status: 400, body: { error: 'This blog is already on the website; its author cannot be changed from here.' } };
    await prisma.drafts.update({ where: { id: nid }, data: { author: name } });
    await prisma.blog_schedule.updateMany({ where: { draft_id: nid, status: { not: 'published' } }, data: { author: name, updated_at: sqlNow() } });
    await activity.log('draft.author_set', { entityType: 'draft', entityId: nid, details: `"${existing.title}" will publish under ${name}${author === 'random' ? ' (picked at random)' : ''}`, actor });
    return { status: 200, body: { ok: true, author: name } };
  }

  // Was: COALESCE(?, col) for each field, updated_at = datetime('now')
  const data: any = {};
  if (title != null) data.title = title;
  if (meta_description != null) data.meta_description = meta_description;
  if (content_html != null) {
    data.content_html = stripActiveContent(String(content_html));
    data.word_count = String(content_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  }
  if (status != null) data.status = status;
  // The words are the same after an alt-text change, so updated_at (which the fact check is tied
  // to) moves only for the fields above.
  if (Object.keys(data).length) data.updated_at = sqlNow();
  if (cover_alt != null) data.cover_alt = String(cover_alt).trim().slice(0, 200) || null;
  if (!Object.keys(data).length) return { status: 400, body: { error: 'Nothing to change' } };
  // The check above and the write are one step: a save (the issue fixer, a fact check) that lands in
  // between is not overwritten.
  // Both can be sent (scripts/draft.ts does): an image placed in the dashboard keeps updated_at but
  // changes the words, so each guard applies.
  const guard = {
    ...(if_updated_at != null ? { updated_at: existing.updated_at } : {}),
    ...(if_text_hash != null ? { title: existing.title, meta_description: existing.meta_description, content_html: existing.content_html } : {}),
  };
  const { count } = await prisma.drafts.updateMany({ where: { id: nid, ...guard }, data });
  if (!count) return { status: 409, body: changedMeanwhile };
  const updated: any = await prisma.drafts.findUnique({ where: { id: nid } });
  // What changed in the words, how much and by whom: shown on the draft and learned from daily.
  if (title != null || meta_description != null || content_html != null) {
    await recordChange({
      entityType: 'draft', entityId: nid, kind: change_source === 'word' ? 'upload' : 'edit', actor: viaToken ? DRAFT_TOKEN_ACTOR : actor, title: updated.title,
      before: { title: existing.title, meta: existing.meta_description, html: existing.content_html || '' },
      after: { title: updated.title, meta: updated.meta_description, html: updated.content_html || '' },
    }).catch(() => null);
  }
  // A person's edit (dashboard or Claude Code) does not start the paid fact check again by itself.
  if (title != null || meta_description != null || content_html != null) await markEditedAsChecked(nid, viaToken ? 'Claude Code' : actor, { before: { textHash: wordsHash(existing), stamp: existing.updated_at } });

  // Approving here counts for the monthly calendar too, so the blog publishes at its slot instead
  // of waiting out the 48 hours. Tax, legal and compliance blogs still need the named CA/CPA, which
  // is picked in Monthly Strategy.
  let calendar: string | null = null;
  if (status === 'approved') {
    const sched = await prisma.blog_schedule.findFirst({ where: { draft_id: nid, status: { in: ['in_review', 'held', 'planned'] }, reviewed_at: null } });
    if (sched) {
      const expertOn = await requireExpert();
      if (expertOn && needsExpertReview(sched.main_keyword, sched.title)) {
        calendar = 'This is a tax, legal or compliance blog: pick the CA/CPA reviewer and approve it in Monthly Strategy, or it will not publish.';
      } else {
        await prisma.blog_schedule.update({ where: { id: sched.id }, data: { reviewed_by: actor, reviewed_at: sqlNow(), updated_at: sqlNow() } });
        calendar = `Approved for the monthly calendar too: ${publishPlan({ ...sched, reviewed_at: sqlNow(), reviewed_by: 'you' }, new Date()).detail}`;
      }
    }
  }

  if (status) {
    await activity.log(`draft.${status}`, {
      entityType: 'draft',
      entityId: nid,
      details: `"${updated.title}"`,
      actor,
    });
  } else {
    await activity.log('draft.edited', {
      entityType: 'draft',
      entityId: nid,
      details: `"${updated.title}"`,
      actor: viaToken ? DRAFT_TOKEN_ACTOR : actor,
    });
  }

  return { status: 200, body: { ...updated, text_hash: wordsHash(updated), calendar } };
}

// Deletes a draft that will not be published. Its facts and image links go with it. A plain blog's
// keyword returns to the pending queue so it can be written again later; a calendar blog is written
// again by the schedule, a topic's blog or article from Topics, and a live blog's keyword stays as it
// is (see requeueAfterDelete). A website post that was already created from this draft is NOT touched.
export async function deleteDraft(nid: number, { actor }: { actor: string }): Promise<Result> {
  const existing: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return { status: 404, body: { error: 'Not found' } };
  const kw = await prisma.keywords.findUnique({ where: { id: existing.keyword_id }, select: { batch_name: true, notes: true } });
  const requeue = requeueAfterDelete(existing, kw?.batch_name);
  await prisma.$transaction(async (tx: any) => {
    await tx.facts.deleteMany({ where: { draft_id: nid } });
    await tx.draft_images.deleteMany({ where: { draft_id: nid } });
    await tx.drafts.deleteMany({ where: { id: nid } });
    // A strategy blog whose draft is deleted goes back to planned, so the autopilot writes it again
    // (also a held one: left 'held' with no draft, it would only be held again and never written).
    // A paused one goes back to planned when it is resumed.
    await tx.blog_schedule.updateMany({ where: { draft_id: nid, status: { in: ['drafting', 'in_review', 'held'] } }, data: { status: 'planned', review_started: null, reviewed_at: null, fact_check: null, hold_reasons: null } });
    await tx.blog_schedule.updateMany({ where: { draft_id: nid, status: 'paused', paused_from: { in: ['drafting', 'in_review', 'held'] } }, data: { paused_from: 'planned', review_started: null, reviewed_at: null, fact_check: null } });
    await tx.blog_schedule.updateMany({ where: { draft_id: nid }, data: { draft_id: null } });
    if (requeue) {
      await tx.keywords.updateMany({
        where: { id: existing.keyword_id, status: { in: ['drafted', 'failed'] } },
        data: { status: 'pending', error: null },
      });
    }
    // A topic whose blog or article is deleted can be written again from Topics & News. Not when the
    // piece is already on the website: the topic stays linked, so it is not written (and paid) twice.
    if (!existing.wp_post_url) {
      await tx.topics.updateMany({ where: { draft_id: nid, status: 'blog' }, data: { status: 'new' } });
      await tx.topics.updateMany({ where: { draft_id: nid }, data: { draft_id: null } });
      await tx.topics.updateMany({ where: { article_draft_id: nid, status: 'article' }, data: { status: 'new' } });
      await tx.topics.updateMany({ where: { article_draft_id: nid }, data: { article_draft_id: null } });
    } else if (kw?.batch_name === 'Topics') {
      await linkLiveTopic(tx, nid, kw.notes);
    }
  });
  await activity.log('draft.deleted', {
    entityType: 'draft',
    entityId: nid,
    details: `"${existing.title || '(untitled)'}" deleted${existing.wp_post_url ? ' (the website post was not touched)' : ''}`,
    actor,
  });
  return { status: 200, body: { deleted: true, keywordId: existing.keyword_id, requeued: requeue } };
}

// "New photo cover": a new photo cover is made and used right away (POST /api/drafts/[id]/cover with
// no body). May use a paid image service (Pexels is free; OpenAI images are paid).
export async function newPhotoCover(id: number): Promise<Result> {
  const draft = await prisma.drafts.findUnique({ where: { id }, select: { id: true, featured_image_path: true } });
  if (!draft) return { status: 404, body: { error: 'Draft not found' } };
  const { ensurePhotoCover } = await import('@/lib/coverPhoto');
  await prisma.drafts.update({ where: { id }, data: { featured_image_path: null } });
  const key = await ensurePhotoCover(id).catch(() => null);
  if (!key) {
    await prisma.drafts.update({ where: { id }, data: { featured_image_path: draft.featured_image_path } });
    return { status: 400, body: { error: 'No photo cover could be made. Add PEXELS_API_KEY (free) or OPENAI_API_KEY in Coolify.' } };
  }
  await prisma.drafts.update({ where: { id }, data: { updated_at: sqlNow() } });
  return { status: 200, body: { ok: true, key } };
}

// Puts back the words the draft had before an optimisation, rewrite or edit (POST /api/drafts/[id]/restore).
export async function restoreDraftVersion(id: number, changeId: unknown, actor: string): Promise<Result> {
  const { restorePoint } = await import('@/lib/contentChanges');
  const point = await restorePoint(Number(changeId));
  if (!point || point.change.entity_type !== 'draft' || point.change.entity_id !== id) return { status: 404, body: { error: 'That earlier version is not available for this draft.' } };
  const d = await prisma.drafts.findUnique({ where: { id } });
  if (!d) return { status: 404, body: { error: 'Draft not found' } };
  if (d.status === 'published') return { status: 409, body: { error: 'This blog is already published; edit the live post instead.' } };
  await prisma.drafts.update({
    where: { id },
    data: { title: point.title ?? d.title, meta_description: point.meta ?? d.meta_description, content_html: point.html, word_count: point.html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, updated_at: sqlNow() },
  });
  await recordChange({ entityType: 'draft', entityId: id, kind: 'restore', actor, title: point.title ?? d.title, before: { title: d.title, meta: d.meta_description, html: d.content_html || '' }, after: { title: point.title ?? d.title, meta: point.meta ?? d.meta_description, html: point.html } }).catch(() => null);
  await markEditedAsChecked(id, actor || 'Restore', { byPerson: false }).catch(() => {});
  await activity.log('draft.restored', { entityType: 'draft', entityId: id, details: `"${d.title}": the version before the ${point.change.kind} of ${point.change.created_at} UTC is back`, actor });
  return { status: 200, body: { ok: true } };
}

// A claim in the Facts Register marked by a reviewer (PATCH /api/facts/[id]): { status }.
export const FACT_STATUSES = ['verified', 'needs_verify'] as const;

// actor: the signed-in person who marks the claim; always recorded as the reviewer (a reviewer name
// in the request is ignored).
export async function setFactStatus(nid: number, input: any, actor: string): Promise<Result> {
  const status = input?.status;
  if (!FACT_STATUSES.includes(status)) return { status: 400, body: { error: `status must be ${FACT_STATUSES.join(' or ')}.` } };
  const reviewer = actor || 'system';
  const existing = await prisma.facts.findUnique({ where: { id: nid } });
  if (!existing) return { status: 404, body: { error: 'Not found' } };
  await prisma.facts.update({ where: { id: nid }, data: { status, review_date: sqlNow(), reviewer } });
  const updated: any = await prisma.facts.findUnique({ where: { id: nid } });
  await activity.log('fact.status_changed', { entityType: 'fact', entityId: nid, details: `"${updated.claim}" → ${status}`, actor: reviewer });
  return { status: 200, body: updated };
}

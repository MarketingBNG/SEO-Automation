import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { markEditedAsChecked, wordsHash } from '@/lib/factCheckMark';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';
import { needsExpertReview, publishPlan } from '@/lib/strategy/core';
import { requireExpert } from '@/lib/reviewers';
import { seoSlug } from '@/lib/wordpress';
import { coverAlt } from '@/lib/cover';
import { DRAFT_TOKEN_ACTOR, hasDraftToken } from '@/lib/draftToken';
import { authorNames, pickAuthor } from '@/lib/authors';
import { requeueAfterDelete } from '@/lib/draftDelete';
import { linkLiveTopic } from '@/lib/topics';
import { recordChange } from '@/lib/contentChanges';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  // Was: SELECT drafts.*, keywords.keyword AS keyword FROM drafts LEFT JOIN keywords ... WHERE drafts.id = ?
  const found: any = await prisma.drafts.findUnique({ where: { id: nid }, include: { keyword: { select: { keyword: true } } } });
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { keyword, ...rest } = found;
  const row = { ...rest, keyword: keyword?.keyword ?? null };
  const [facts, sched] = await Promise.all([
    prisma.facts.findMany({ where: { draft_id: nid }, orderBy: { id: 'asc' } }),
    prisma.blog_schedule.findFirst({ where: { draft_id: nid } }),
  ]);
  // Its place on the monthly calendar (when it publishes, under whom), for the review screen.
  const expertOn = sched ? await requireExpert() : false;
  const schedule = sched
    ? {
        id: sched.id,
        strategy_id: sched.strategy_id,
        status: sched.status,
        publish_at: sched.publish_at,
        reviewed_at: sched.reviewed_at,
        reviewed_by: sched.reviewed_by,
        expert_reviewer: sched.expert_reviewer,
        author: sched.author,
        cta: JSON.parse(sched.cta || 'null'),
        hold_reasons: JSON.parse(sched.hold_reasons || '[]'),
        wp_post_url: sched.wp_post_url,
        needs_expert: expertOn && needsExpertReview(sched.main_keyword, sched.title),
        publish_plan: publishPlan(sched, new Date(), { requireExpert: expertOn }),
      }
    : null;
  const site = (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
  const planned_url = found.wp_post_url || `${site}/${seoSlug(sched?.main_keyword || row.keyword || found.title || '')}/`;
  return NextResponse.json({ ...row, text_hash: wordsHash(found), facts, schedule, planned_url, cover_alt_shown: coverAlt(found), author_options: await authorNames() }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const { title, meta_description, content_html, status, cover_alt, author, if_updated_at, if_text_hash, change_source }: any = (await req.json().catch(() => ({}))) || {};
  const existing = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Claude Code edits words only; approving, rejecting and publishing stay with a signed-in person.
  const viaToken = hasDraftToken(req);
  if (viaToken && (status != null || cover_alt != null || author != null)) return NextResponse.json({ error: 'The edit token changes only the title, meta description and article. Approve or reject in the dashboard.' }, { status: 403 });
  // Only the review states the screen sets. 'published' comes only from a real publish (it needs the
  // WordPress post), and a blog already live is not moved back to review here.
  if (status != null && !['approved', 'rejected', 'pending_review'].includes(status)) {
    return NextResponse.json({ error: 'Status must be approved, rejected or pending_review. Publishing is done with Publish.' }, { status: 400 });
  }
  if (status != null && existing.status === 'published') {
    return NextResponse.json({ error: 'This blog is already published; its review status cannot change here.' }, { status: 409 });
  }
  // Sent by scripts/draft.ts: refuse when someone saved the draft after it was read.
  const changedMeanwhile = { error: `The draft was changed at ${existing.updated_at} (after it was read). Read it again and redo the edit.` };
  if (if_updated_at != null && String(if_updated_at) !== String(existing.updated_at)) return NextResponse.json(changedMeanwhile, { status: 409 });
  // Sent by the Drafts editor: refuse only when the words changed after the boxes were loaded (a new
  // cover or a status change meanwhile is not a conflict).
  if (if_text_hash != null && String(if_text_hash) !== wordsHash(existing)) return NextResponse.json(changedMeanwhile, { status: 409 });

  // The partner the blog is published under: one of the names in the list, or "random" for a new
  // random pick. Set on the draft and on its calendar row, which both publish routes read.
  if (author != null) {
    const names = await authorNames();
    const name = author === 'random' ? pickAuthor(names) : names.find((n) => n === author);
    if (!name) return NextResponse.json({ error: `Pick one of: ${names.join(', ')}.` }, { status: 400 });
    if (existing.wp_post_url) return NextResponse.json({ error: 'This blog is already on the website; change its author in WordPress.' }, { status: 400 });
    await prisma.drafts.update({ where: { id: nid }, data: { author: name } });
    await prisma.blog_schedule.updateMany({ where: { draft_id: nid, status: { not: 'published' } }, data: { author: name, updated_at: sqlNow() } });
    await activity.log('draft.author_set', { entityType: 'draft', entityId: nid, details: `"${existing.title}" will publish under ${name}${author === 'random' ? ' (picked at random)' : ''}`, actor: await getActor() });
    return NextResponse.json({ ok: true, author: name });
  }

  // Was: COALESCE(?, col) for each field, updated_at = datetime('now')
  const data: any = {};
  if (title != null) data.title = title;
  if (meta_description != null) data.meta_description = meta_description;
  if (content_html != null) {
    data.content_html = content_html;
    data.word_count = String(content_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  }
  if (status != null) data.status = status;
  // The words are the same after an alt-text change, so updated_at (which the fact check is tied
  // to) moves only for the fields above.
  if (Object.keys(data).length) data.updated_at = sqlNow();
  if (cover_alt != null) data.cover_alt = String(cover_alt).trim().slice(0, 200) || null;
  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  // The check above and the write are one step: a save (the issue fixer, a fact check) that lands in
  // between is not overwritten.
  // Both can be sent (scripts/draft.ts does): an image placed in the dashboard keeps updated_at but
  // changes the words, so each guard applies.
  const guard = {
    ...(if_updated_at != null ? { updated_at: existing.updated_at } : {}),
    ...(if_text_hash != null ? { title: existing.title, meta_description: existing.meta_description, content_html: existing.content_html } : {}),
  };
  const { count } = await prisma.drafts.updateMany({ where: { id: nid, ...guard }, data });
  if (!count) return NextResponse.json(changedMeanwhile, { status: 409 });
  const updated: any = await prisma.drafts.findUnique({ where: { id: nid } });
  // What changed in the words, how much and by whom: shown on the draft and learned from daily.
  if (title != null || meta_description != null || content_html != null) {
    await recordChange({
      entityType: 'draft', entityId: nid, kind: change_source === 'word' ? 'upload' : 'edit', actor: viaToken ? DRAFT_TOKEN_ACTOR : await getActor(), title: updated.title,
      before: { title: existing.title, meta: existing.meta_description, html: existing.content_html || '' },
      after: { title: updated.title, meta: updated.meta_description, html: updated.content_html || '' },
    }).catch(() => null);
  }
  // A person's edit (dashboard or Claude Code) does not start the paid fact check again by itself.
  if (title != null || meta_description != null || content_html != null) await markEditedAsChecked(nid, viaToken ? 'Claude Code' : await getActor(), { before: { textHash: wordsHash(existing), stamp: existing.updated_at } });

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
        await prisma.blog_schedule.update({ where: { id: sched.id }, data: { reviewed_by: await getActor(), reviewed_at: sqlNow(), updated_at: sqlNow() } });
        calendar = `Approved for the monthly calendar too: ${publishPlan({ ...sched, reviewed_at: sqlNow(), reviewed_by: 'you' }, new Date()).detail}`;
      }
    }
  }

  if (status) {
    await activity.log(`draft.${status}`, {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${updated.title}"`,
      actor: await getActor(),
    });
  } else {
    await activity.log('draft.edited', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${updated.title}"`,
      actor: viaToken ? DRAFT_TOKEN_ACTOR : await getActor(),
    });
  }

  return NextResponse.json({ ...updated, text_hash: wordsHash(updated), calendar }, { status: 200 });
}

// Deletes a draft that will not be published. Its facts and image links go with it. A plain blog's
// keyword returns to the pending queue so it can be written again later; a calendar blog is written
// again by the schedule, a topic's blog or article from Topics, and a live blog's keyword stays as it
// is (see requeueAfterDelete). A WordPress post that was already created from this draft is NOT touched.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const existing: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    entityId: Number(id),
    details: `"${existing.title || '(untitled)'}" deleted${existing.wp_post_url ? ' (the WordPress post was not touched)' : ''}`,
    actor: await getActor(),
  });
  return NextResponse.json({ deleted: true, keywordId: existing.keyword_id, requeued: requeue }, { status: 200 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT };

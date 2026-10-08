import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';
import { needsExpertReview, publishPlan } from '@/lib/strategy/core';
import { requireExpert } from '@/lib/reviewers';
import { seoSlug } from '@/lib/wordpress';
import { coverAlt } from '@/lib/cover';

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
  return NextResponse.json({ ...row, facts, schedule, planned_url, cover_alt_shown: coverAlt(found) }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const { title, meta_description, content_html, status, cover_alt }: any = (await req.json().catch(() => ({}))) || {};
  const existing = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Was: COALESCE(?, col) for each field, updated_at = datetime('now')
  const data: any = {};
  if (title != null) data.title = title;
  if (meta_description != null) data.meta_description = meta_description;
  if (content_html != null) data.content_html = content_html;
  if (status != null) data.status = status;
  // The words are the same after an alt-text change, so updated_at (which the fact check is tied
  // to) moves only for the fields above.
  if (Object.keys(data).length) data.updated_at = sqlNow();
  if (cover_alt != null) data.cover_alt = String(cover_alt).trim().slice(0, 200) || null;
  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  const updated: any = await prisma.drafts.update({ where: { id: nid }, data });

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
      actor: await getActor(),
    });
  }

  return NextResponse.json({ ...updated, calendar }, { status: 200 });
}

// Deletes a draft that will not be published. Its facts and image links go with it. The keyword
// returns to the pending queue so it can be written again later. A WordPress post that was
// already created from this draft is NOT touched.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const existing: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.$transaction(async (tx: any) => {
    await tx.facts.deleteMany({ where: { draft_id: nid } });
    await tx.draft_images.deleteMany({ where: { draft_id: nid } });
    await tx.drafts.deleteMany({ where: { id: nid } });
    // A strategy blog whose draft is deleted goes back to planned, so the autopilot writes it again.
    await tx.blog_schedule.updateMany({ where: { draft_id: nid, status: { in: ['drafting', 'in_review'] } }, data: { status: 'planned', review_started: null, reviewed_at: null, fact_check: null } });
    await tx.blog_schedule.updateMany({ where: { draft_id: nid }, data: { draft_id: null } });
    await tx.keywords.updateMany({
      where: { id: existing.keyword_id, status: { in: ['drafted', 'failed'] } },
      data: { status: 'pending', error: null },
    });
  });
  await activity.log('draft.deleted', {
    entityType: 'draft',
    entityId: Number(id),
    details: `"${existing.title || '(untitled)'}" deleted${existing.wp_post_url ? ' (the WordPress post was not touched)' : ''}`,
    actor: await getActor(),
  });
  return NextResponse.json({ deleted: true, keywordId: existing.keyword_id }, { status: 200 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT };

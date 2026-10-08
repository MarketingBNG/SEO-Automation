import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';

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
  const facts = await prisma.facts.findMany({ where: { draft_id: nid }, orderBy: { id: 'asc' } });
  return NextResponse.json({ ...row, facts }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const { title, meta_description, content_html, status }: any = (await req.json().catch(() => ({}))) || {};
  const existing = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Was: COALESCE(?, col) for each field, updated_at = datetime('now')
  const data: any = { updated_at: sqlNow() };
  if (title != null) data.title = title;
  if (meta_description != null) data.meta_description = meta_description;
  if (content_html != null) data.content_html = content_html;
  if (status != null) data.status = status;
  const updated: any = await prisma.drafts.update({ where: { id: nid }, data });

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

  return NextResponse.json(updated, { status: 200 });
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

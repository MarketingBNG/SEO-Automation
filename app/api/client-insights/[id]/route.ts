import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const { status, overview }: any = (await req.json().catch(() => ({}))) || {};
  const existing = await prisma.client_insights.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (status && !['approved', 'rejected', 'pending_review'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  // Was: overview = COALESCE(?, overview), status = COALESCE(?, status),
  //      decided_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE decided_at END
  const data: any = {};
  if (overview != null) data.overview = overview;
  if (status != null) {
    data.status = status;
    data.decided_at = sqlNow();
  }
  if (Object.keys(data).length) await prisma.client_insights.update({ where: { id: nid }, data });

  const updated: any = await prisma.client_insights.findUnique({ where: { id: nid } });

  if (status) {
    await activity.log(`client_insight.${status}`, {
      entityType: 'client_insight',
      entityId: Number(id),
      details: updated.title || '(untitled meeting)',
      actor: await getActor(),
    });
  }

  return NextResponse.json(updated, { status: 200 });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await prisma.client_insights.deleteMany({ where: { id: toId(id) } });
  return NextResponse.json({ ok: true }, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT };

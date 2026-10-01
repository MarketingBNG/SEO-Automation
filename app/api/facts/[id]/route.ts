import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const body: any = (await req.json().catch(() => ({}))) || {};
  const { status } = body;
  // The dashboard used to send a hardcoded reviewer name; it is now the signed-in user.
  const reviewer = body.reviewer ?? (status != null ? await getActor() : null);
  const existing = await prisma.facts.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Was: status = COALESCE(?, status), reviewer = COALESCE(?, reviewer),
  //      review_date = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE review_date END
  const data: any = {};
  if (status != null) {
    data.status = status;
    data.review_date = sqlNow();
  }
  if (reviewer != null) data.reviewer = reviewer;
  if (Object.keys(data).length) await prisma.facts.update({ where: { id: nid }, data });

  const updated: any = await prisma.facts.findUnique({ where: { id: nid } });

  if (status) {
    await activity.log('fact.status_changed', {
      entityType: 'fact',
      entityId: Number(id),
      details: `"${updated.claim}" → ${status}`,
      actor: reviewer || 'system',
    });
  }

  return NextResponse.json(updated, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

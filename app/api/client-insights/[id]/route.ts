import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../_lib/http';
import { reviewInsight } from '@/lib/clientInsightActions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body: any = (await req.json().catch(() => ({}))) || {};
  // Shared with the assistant's meeting_insight_review (lib/clientInsightActions.ts).
  const r = await reviewInsight(toId(id), body, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const row = await prisma.client_insights.findUnique({ where: { id: nid } });
  if (!row) return NextResponse.json({ ok: true }, { status: 200 });
  // A Fireflies meeting is kept as an empty 'deleted' marker instead of removed: the daily sync finds
  // meetings by transcript_id, and would import, clean (paid) and maybe approve a removed one again.
  // Its text (which may hold client figures or contact details) is removed, and the list hides it.
  if (row.transcript_id) {
    await prisma.client_insights.update({ where: { id: nid }, data: { status: 'deleted', decided_at: sqlNow(), title: '', overview: '', action_items: '', keywords: '[]' } });
  }
  else await prisma.client_insights.deleteMany({ where: { id: nid } });
  await activity.log('client_insight.deleted', {
    entityType: 'client_insight',
    entityId: nid,
    details: `${row.title || '(untitled meeting)'}${row.transcript_id ? ' (its text removed; kept as a marker so the sync does not bring it back)' : ''}`,
    actor: await getActor(),
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT };

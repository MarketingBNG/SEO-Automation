import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const { status }: any = (await req.json().catch(() => ({}))) || {}; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 });
  }

  await prisma.research_digests.updateMany({ where: { id: nid }, data: { status, decided_at: sqlNow() } });
  const row: any = await prisma.research_digests.findUnique({ where: { id: nid } });
  await activity.log(`research.digest_${status}`, {
    entityType: 'research_digest',
    entityId: Number(id),
    details: row.topic || 'general',
    actor: await getActor(),
  });
  return NextResponse.json(row, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor, getMe } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// { status: 'done' | 'planned' }: backlink outreach is done by a person, so it is ticked off here.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { status }: any = (await req.json().catch(() => ({}))) || {};
  if (!['done', 'planned'].includes(status)) return NextResponse.json({ error: 'status must be done or planned' }, { status: 400 });
  const id = toId((await params).id);
  const me = await getMe();
  if (me?.role === 'user') {
    const t = await prisma.backlink_tasks.findUnique({ where: { id }, select: { assigned_to: true } });
    if (t?.assigned_to !== me.email) return NextResponse.json({ error: 'This task is not assigned to you.' }, { status: 403 });
  }
  const row = await prisma.backlink_tasks.update({ where: { id }, data: { status } });
  await activity.log(`backlink.${status}`, { entityType: 'backlink_task', entityId: id, details: `${row.method}: ${row.target_site}`, actor: await getActor() });
  return NextResponse.json(row);
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Reviewer marks a blog in its 24-hour window as reviewed (the edited draft is what publishes).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const { action }: any = (await req.json().catch(() => ({}))) || {};
  if (action !== 'reviewed') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'published') return NextResponse.json({ error: 'Already published' }, { status: 409 });
  const actor = await getActor();
  const updated = await prisma.blog_schedule.update({ where: { id }, data: { reviewed_by: actor, reviewed_at: sqlNow(), updated_at: sqlNow() } });
  await activity.log('schedule.reviewed', { entityType: 'blog_schedule', entityId: id, details: row.title, actor });
  return NextResponse.json(updated);
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

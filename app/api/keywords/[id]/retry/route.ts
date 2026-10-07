import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// POST: puts a failed keyword back in the queue, so "Generate next blog draft" writes it again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const k = await prisma.keywords.findUnique({ where: { id } });
  if (!k) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (k.status !== 'failed') return NextResponse.json({ error: 'Only a failed keyword can be retried.' }, { status: 409 });
  await prisma.keywords.update({ where: { id }, data: { status: 'pending', error: null, progress_stage: null, progress_percent: null } });
  await activity.log('keywords.retry', { entityType: 'keyword', entityId: id, details: `"${k.keyword}" put back in the queue`, actor: await getActor() });
  return NextResponse.json({ ok: true });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { retryKeyword } from '@/lib/generateActions';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// POST: puts a failed keyword back in the queue, so "Generate next blog draft" writes it again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const r = await retryKeyword(id, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

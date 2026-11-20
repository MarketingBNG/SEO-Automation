import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { setFactStatus } from '@/lib/draftActions';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';

// { status: 'verified' | 'needs_verify' }: a claim in the Facts Register marked by a reviewer
// (lib/draftActions.ts). The reviewer is always the signed-in person; a reviewer in the body is ignored.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await setFactStatus(toId(id), body, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { restoreDraftVersion } from '@/lib/draftActions';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// POST { changeId }: put back the words the draft had before that optimisation or rewrite.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const { changeId }: any = (await req.json().catch(() => ({}))) || {};
  const r = await restoreDraftVersion(id, changeId, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

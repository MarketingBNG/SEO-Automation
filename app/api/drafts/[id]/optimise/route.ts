import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { isOptimising, startOptimise } from '@/lib/optimise';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// POST: optimise this draft for SEO, AEO and GEO, keeping the author's text and facts. Runs in the
// background; the draft's words are replaced when it is done, with the previous version kept for
// Restore. GET: whether one is running now.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await startOptimise(toId((await params).id), await getActor()), { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ running: isOptimising(toId((await params).id)) });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

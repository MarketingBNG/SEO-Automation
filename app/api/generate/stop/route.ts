import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { stopGeneration } from '@/lib/generateActions';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Stops one blog generation: { keywordId }. Other people's blogs (Topics, resumed runs) keep going,
// so a body without a keyword id is refused. See lib/generateActions.ts.
export async function POST(req: NextRequest) {
  const { keywordId }: any = (await req.json().catch(() => ({}))) || {};
  const r = await stopGeneration(keywordId, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

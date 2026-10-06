import { NextRequest, NextResponse } from 'next/server';
import { strategyProgress } from '@/lib/strategy/progress';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// How far the strategy has got and the estimated AI cost for its 30 days.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = await strategyProgress(toId((await params).id));
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(p);
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

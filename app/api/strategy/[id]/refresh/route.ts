import { NextRequest, NextResponse } from 'next/server';
import { refreshStrategy } from '@/lib/strategy/refresh';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Brings the strategy up to date with new dashboard features and new data without rebuilding it.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await refreshStrategy(toId((await params).id), await getActor()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

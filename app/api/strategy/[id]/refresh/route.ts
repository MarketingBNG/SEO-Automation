import { NextRequest, NextResponse } from 'next/server';
import { refreshStrategy } from '@/lib/strategy/refresh';
import { timed } from '@/lib/jobTimer';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Brings the strategy up to date with new dashboard features and new data without rebuilding it.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sid = toId((await params).id);
    const actor = await getActor();
    return NextResponse.json(await timed(`refresh-${sid}`, 'refresh', 'Updating the strategy with the latest changes', () => refreshStrategy(sid, actor)));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

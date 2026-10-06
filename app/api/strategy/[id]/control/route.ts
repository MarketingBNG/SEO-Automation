import { NextRequest, NextResponse } from 'next/server';
import { controlStrategyJob } from '@/lib/strategy/jobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// { action: 'pause' | 'resume' | 'stop' } for a strategy that is being generated.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { action }: any = (await req.json().catch(() => ({}))) || {};
  if (!['pause', 'resume', 'stop'].includes(action)) return NextResponse.json({ error: 'action must be pause, resume or stop' }, { status: 400 });
  try {
    return NextResponse.json(await controlStrategyJob(toId((await params).id), action, await getActor()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

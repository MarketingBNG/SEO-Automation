import { NextRequest, NextResponse } from 'next/server';
import { logStrategyChange } from '@/lib/strategy/service';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Mid-month "Strategy change": { what, why }. Approved by the signed-in user; date is recorded.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await logStrategyChange(toId((await params).id), body, await getActor()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

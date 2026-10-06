import { NextRequest, NextResponse } from 'next/server';
import { approveStrategy } from '@/lib/strategy/service';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// One approval for the whole month. Refused (409) without a fresh Screaming Frog upload or while
// validation errors remain; the server checks this, not just the disabled button.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await approveStrategy(toId((await params).id), await getActor()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message, blockers: err.blockers || [] }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

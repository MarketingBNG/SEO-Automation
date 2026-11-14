import { NextRequest, NextResponse } from 'next/server';
import { getActor, getMe } from '@/lib/auth';
import { setBacklinkStatus } from '@/lib/strategy/manualActions';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// { status: 'done' | 'planned' }: backlink outreach is done by a person, so it is ticked off here.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { status }: any = (await req.json().catch(() => ({}))) || {};
  const id = toId((await params).id);
  const r = await setBacklinkStatus(id, status, { me: await getMe(), actor: await getActor() });
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

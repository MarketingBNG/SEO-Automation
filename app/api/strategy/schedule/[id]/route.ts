import { NextRequest, NextResponse } from 'next/server';
import { getActor, getMe } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { decideSchedule, scheduleSuggestions } from '@/lib/strategy/scheduleActions';

export const runtime = 'nodejs';

// A reviewer decides on a blog in its 48-hour review: approve, reject, pause, resume, publish_now,
// mark_done or reschedule. The rules are in lib/strategy/scheduleActions.ts, shared with the assistant.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await decideSchedule(id, body, { me: await getMe(), actor: await getActor() });
  return NextResponse.json(r.body, { status: r.status });
}

// GET: suggested new publish times for this blog.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await scheduleSuggestions(toId((await params).id));
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

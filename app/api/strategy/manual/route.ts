import { NextRequest, NextResponse } from 'next/server';
import { manualTaskAction } from '@/lib/strategy/manualActions';
import { getMe } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// { kind: 'backlink' | 'fix', id, action: 'guide' | 'done' | 'undo' | 'assign', regenerate?, email? }
// Users may only work on tasks assigned to them; assigning is for admins and managers.
// The rules are in lib/strategy/manualActions.ts, shared with the assistant.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await manualTaskAction(body, await getMe());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

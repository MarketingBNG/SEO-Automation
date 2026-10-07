import { NextRequest, NextResponse } from 'next/server';
import { guideFor, setManualDone, assignTask, assignedTo } from '@/lib/strategy/manual';
import { getMe } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// { kind: 'backlink' | 'fix', id, action: 'guide' | 'done' | 'undo' | 'assign', regenerate?, email? }
// Users may only work on tasks assigned to them; assigning is for admins and managers.
export async function POST(req: NextRequest) {
  const { kind, id, action, regenerate, email }: any = (await req.json().catch(() => ({}))) || {};
  if (!['backlink', 'fix'].includes(kind) || !Number.isInteger(Number(id))) return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    if (action === 'assign') {
      if (!can(me.role, 'manual.assign')) return NextResponse.json({ error: 'Only an admin or a manager can assign tasks.' }, { status: 403 });
      await assignTask(kind, Number(id), email || null, me.name);
      return NextResponse.json({ ok: true });
    }
    if (me.role === 'user' && (await assignedTo(kind, Number(id))) !== me.email) {
      return NextResponse.json({ error: 'This task is not assigned to you.' }, { status: 403 });
    }
    if (action === 'guide') return NextResponse.json({ guide: await guideFor(kind, Number(id), { regenerate: Boolean(regenerate) }) });
    if (action === 'done' || action === 'undo') return NextResponse.json(await setManualDone(kind, Number(id), action === 'done', me.name));
    return NextResponse.json({ error: 'action must be guide, done, undo or assign' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

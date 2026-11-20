import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { canSetFor, ensureWorkToken, getCurrent, setCurrentTask, todayEntries } from '@/lib/worklog';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the signed-in person's current task and today's work blocks. ?person=<email> shows that
// person's, for their manager or the admin only.
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const person = String(req.nextUrl.searchParams.get('person') || '').toLowerCase() || me.email.toLowerCase();
  if (person !== me.email.toLowerCase() && !(await canSetFor(me, person))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const [current, entries] = await Promise.all([getCurrent(person), todayEntries(person)]);
  // Zoho Projects connection + the task list come in part (b); none yet, so the picker starts empty.
  return NextResponse.json({ email: person, current, entries, zohoConnected: false, tasks: [] });
}

// POST { action: 'set-task', email?, taskId, taskName, projectId?, projectName? } - set the current
// task (self, a manager for their team, or the admin). { action: 'token', email } - the admin gets a
// person's watcher token for device setup.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  try {
    if (body.action === 'set-task') {
      const email = String(body.email || me.email).toLowerCase();
      return NextResponse.json(await setCurrentTask(me, email, { taskId: body.taskId, taskName: body.taskName, projectId: body.projectId, projectName: body.projectName }));
    }
    if (body.action === 'token') {
      if (me.role !== 'admin') return NextResponse.json({ error: 'Only the admin can get a device token.' }, { status: 403 });
      const email = String(body.email || '').toLowerCase();
      if (!email) return NextResponse.json({ error: 'Which person?' }, { status: 400 });
      return NextResponse.json({ token: await ensureWorkToken(email) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

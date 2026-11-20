// Manual tasks of the monthly strategy (backlink outreach, fixes a person makes), as the Monthly
// Strategy page works on them. Shared by /api/strategy/manual, /api/strategy/backlinks/[id] and the
// assistant's manual task tools. Each returns { status, body } exactly as the route answers.
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { canDo } from '@/lib/access';
import { timed } from '@/lib/jobTimer';
import { guideFor, setManualDone, saveTaskDetails, assignTask, assignedTo, isPersonTask } from './manual';
import type { Role } from '@/lib/permissions';

export type TaskMe = { email: string; name?: string; role: Role; blocked?: boolean } | null;
type Result = { status: number; body: any };

// { kind: 'backlink' | 'fix', id, action: 'guide' | 'done' | 'undo' | 'assign' | 'details', regenerate?,
//   email?, listingUrl?, notes? }
// Users may only work on tasks assigned to them; assigning is for admins and managers. done and
// details save the listing address and notes (undo keeps them).
export async function manualTaskAction(input: any, me: TaskMe): Promise<Result> {
  const { kind, id, action, regenerate, email, listingUrl, notes }: any = input || {};
  if (!['backlink', 'fix'].includes(kind) || !Number.isInteger(Number(id))) return { status: 400, body: { error: 'kind and id are required' } };
  if (!me) return { status: 401, body: { error: 'Not signed in' } };
  const name = me.name || me.email;
  try {
    if (action === 'assign') {
      if (!(await canDo(me, 'manual.assign'))) return { status: 403, body: { error: 'Only an admin or a manager can assign tasks.' } };
      await assignTask(kind, Number(id), email || null, name);
      return { status: 200, body: { ok: true } };
    }
    if (me.role === 'user' && (await assignedTo(kind, Number(id))) !== me.email) {
      return { status: 403, body: { error: 'This task is not assigned to you.' } };
    }
    if (action === 'guide') return { status: 200, body: { guide: await timed(`guide-${kind}-${id}`, 'guide', 'Writing a step-by-step guide', () => guideFor(kind, Number(id), { regenerate: Boolean(regenerate) })) } };
    if (action === 'done' || action === 'undo') return { status: 200, body: await setManualDone(kind, Number(id), action === 'done', name, { email: me.email, ...(action === 'done' ? { listingUrl, notes } : {}) }) };
    if (action === 'details') return { status: 200, body: await saveTaskDetails(kind, Number(id), { listingUrl, notes }, name) };
    return { status: 400, body: { error: 'action must be guide, done, undo, assign or details' } };
  } catch (err: any) {
    return { status: err.status || 500, body: { error: err.message } };
  }
}

// { status: 'done' | 'planned' }: backlink outreach is done by a person, so it is ticked off here.
export async function setBacklinkStatus(id: number, status: any, { me, actor }: { me: TaskMe; actor: string }): Promise<Result> {
  if (!['done', 'planned'].includes(status)) return { status: 400, body: { error: 'status must be done or planned' } };
  if (me?.role === 'user') {
    const t = await prisma.backlink_tasks.findUnique({ where: { id }, select: { assigned_to: true } });
    if (t?.assigned_to !== me.email) return { status: 403, body: { error: 'This task is not assigned to you.' } };
  }
  const cur = await prisma.backlink_tasks.findUnique({ where: { id } });
  if (!cur) return { status: 404, body: { error: 'Task not found' } };
  // A listing or sign-up a person does is ticked here too: it keeps who and when, and unticking it
  // puts it back on the to-do list, never into the automatic outreach queue.
  if (isPersonTask(cur)) {
    const row = await setManualDone('backlink', id, status === 'done', actor, { email: me?.email || null });
    return { status: 200, body: row };
  }
  const row = await prisma.backlink_tasks.update({ where: { id }, data: { status } });
  await activity.log(`backlink.${status}`, { entityType: 'backlink_task', entityId: id, details: `${row.method}: ${row.target_site}`, actor });
  return { status: 200, body: row };
}

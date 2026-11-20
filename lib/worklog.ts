// Per-task worklog: the task a person is on, and the blocks of active time the watcher measures,
// which become one Zoho timesheet entry each (per task, per entry). This file keeps the blocks in our
// database. Pushing them to Zoho Projects is a separate step (lib/zohoProjects.ts), switched on only
// after a live test, so nothing wrong is written to a real timesheet meanwhile.
import crypto from 'crypto';
import prismaClient from './prisma';
import { sqlNow } from './time';
import { istDay } from './topics';

const prisma: any = prismaClient;

// Who may set a person's current task: the person themselves, their team's manager, or the admin.
export async function canSetFor(actor: { email: string; role: string }, email: string): Promise<boolean> {
  const who = email.toLowerCase();
  if (actor.email.toLowerCase() === who) return true;
  if (actor.role === 'admin') return true;
  if (actor.role !== 'manager') return false;
  const [me, them] = await Promise.all([
    prisma.team_members.findUnique({ where: { email: actor.email.toLowerCase() }, select: { team: true } }),
    prisma.team_members.findUnique({ where: { email: who }, select: { team: true } }),
  ]);
  return Boolean(me?.team && them?.team && me.team === them.team);
}

export async function getCurrent(email: string) {
  return prisma.work_current.findUnique({ where: { email: email.toLowerCase() } });
}

// Close the open block for a person (stamp its end). The active time stays as measured.
async function closeOpenEntry(email: string) {
  const cur = await prisma.work_current.findUnique({ where: { email } });
  if (cur?.entry_id) await prisma.work_entries.updateMany({ where: { id: cur.entry_id, ended_at: null }, data: { ended_at: sqlNow() } });
}

// Set the task a person is working on now. Closes the previous block and opens a new one.
export async function setCurrentTask(
  actor: { email: string; role: string },
  email: string,
  task: { taskId?: string | null; taskName?: string | null; projectId?: string | null; projectName?: string | null },
) {
  const who = email.toLowerCase();
  if (!(await canSetFor(actor, who))) throw Object.assign(new Error('You cannot set this person’s task.'), { status: 403 });
  await closeOpenEntry(who);
  const setBy = actor.email.toLowerCase() === who ? 'self' : actor.role;
  let entryId: number | null = null;
  if (task.taskId) {
    const entry = await prisma.work_entries.create({
      data: { email: who, day: istDay(), task_id: String(task.taskId), task_name: task.taskName || null, project_id: task.projectId || null, source: 'watcher' },
    });
    entryId = entry.id;
  }
  await prisma.work_current.upsert({
    where: { email: who },
    create: { email: who, task_id: task.taskId || null, task_name: task.taskName || null, project_id: task.projectId || null, project_name: task.projectName || null, entry_id: entryId, since: sqlNow(), set_by: setBy },
    update: { task_id: task.taskId || null, task_name: task.taskName || null, project_id: task.projectId || null, project_name: task.projectName || null, entry_id: entryId, since: sqlNow(), set_by: setBy },
  });
  return { ok: true };
}

// The watcher reports active time (ms) since its last report. It is added to the person's current open
// block. With no task chosen, it goes to an "unassigned" block for the day so the time is not lost.
export async function reportActive(email: string, ms: number) {
  const who = email.toLowerCase();
  const add = Math.max(0, Math.min(Math.round(Number(ms) || 0), 3600000)); // at most one hour per report
  if (!add) return { ok: true, added: 0 };
  const cur = await prisma.work_current.findUnique({ where: { email: who } });
  let entryId = cur?.entry_id || null;
  if (!entryId) {
    // No task chosen: append to today's open unassigned block, or start one.
    const open = await prisma.work_entries.findFirst({ where: { email: who, day: istDay(), task_id: null, ended_at: null }, orderBy: { id: 'desc' } });
    entryId = open?.id || (await prisma.work_entries.create({ data: { email: who, day: istDay(), source: 'watcher' } })).id;
  }
  await prisma.work_entries.update({ where: { id: entryId }, data: { active_ms: { increment: add } } });
  return { ok: true, added: add };
}

// Today's blocks for a person (task and active time), newest first.
export async function todayEntries(email: string, day = istDay()) {
  const rows = await prisma.work_entries.findMany({ where: { email: email.toLowerCase(), day }, orderBy: { id: 'desc' } });
  return rows.map((r: any) => ({ id: r.id, taskId: r.task_id, taskName: r.task_name || (r.task_id ? null : 'Unassigned'), projectId: r.project_id, activeMs: r.active_ms, startedAt: r.started_at, endedAt: r.ended_at, logged: Boolean(r.logged_at), source: r.source }));
}

// The per-person watcher token (created once). Returned only to the admin during device setup.
export async function ensureWorkToken(email: string) {
  const who = email.toLowerCase();
  const existing = await prisma.work_tokens.findUnique({ where: { email: who } });
  if (existing) return existing.token;
  const token = crypto.randomBytes(24).toString('hex');
  await prisma.work_tokens.create({ data: { email: who, token } }).catch(() => {});
  return (await prisma.work_tokens.findUnique({ where: { email: who } }))!.token;
}

// Find whose token this is (for the watcher ingest endpoint). Null when unknown.
export async function emailForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const row = await prisma.work_tokens.findUnique({ where: { token }, select: { email: true } });
  return row?.email || null;
}

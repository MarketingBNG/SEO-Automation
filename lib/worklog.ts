// Per-task worklog: the task a person is on, and the blocks of active time the watcher measures,
// which become one Zoho timesheet entry each (per task, per entry). This file keeps the blocks in our
// database. Pushing them to Zoho Projects is a separate step (lib/zohoProjects.ts), switched on only
// after a live test, so nothing wrong is written to a real timesheet meanwhile.
import crypto from 'crypto';
import prismaClient from './prisma';
import { sqlNow } from './time';
import { istDay } from './topics';
import { tookMs, visibleEmails } from './associateTrainingView';
import { trainingGate } from './trainingGate';

const prisma: any = prismaClient;

// The activity watcher reports what apps were active and for how long. This updates the day's
// attendance span (first report = auto-login, last report = until manual logout) and the per-app
// active time. Nothing here is shown to the person; only the admin and managers see it.
export async function reportActivity(email: string, apps: { app?: string; ms?: number }[]) {
  const who = email.toLowerCase();
  const day = istDay();
  const now = sqlNow();
  await prisma.work_attendance.upsert({
    where: { email_day: { email: who, day } },
    create: { email: who, day, first_at: now, last_at: now },
    update: { last_at: now },
  });
  for (const a of (Array.isArray(apps) ? apps : []).slice(0, 50)) {
    const app = String(a?.app || 'Unknown').slice(0, 200);
    const ms = Math.max(0, Math.min(Math.round(Number(a?.ms) || 0), 3600000));
    if (!ms) continue;
    await prisma.work_activity.upsert({
      where: { email_day_app: { email: who, day, app } },
      create: { email: who, day, app, active_ms: ms },
      update: { active_ms: { increment: ms } },
    });
  }
  return { ok: true };
}

// The activity and attendance report for the admin and managers, scoped: the admin sees everyone,
// a manager sees their team (not themselves), a person sees nothing. gapMs (span - active) is the
// time not captured on the device, which goes to the General task in the timesheet.
export async function activityReport(me: { email: string; role: string }, day = istDay()) {
  const only = await visibleEmails(me);
  const team = await prisma.team_members.findMany({ where: { role: { not: 'admin' } }, select: { email: true, name: true, team: true } });
  const people = team.filter((t: any) => !only || only.has(t.email.toLowerCase()));
  const out: any[] = [];
  for (const p of people) {
    const who = p.email.toLowerCase();
    const [att, acts] = await Promise.all([
      prisma.work_attendance.findUnique({ where: { email_day: { email: who, day } } }),
      prisma.work_activity.findMany({ where: { email: who, day }, orderBy: { active_ms: 'desc' } }),
    ]);
    const activeMs = acts.reduce((s: number, a: any) => s + a.active_ms, 0);
    const spanMs = att ? tookMs(att.first_at, att.last_at) : null;
    out.push({
      email: who,
      name: p.name,
      team: p.team,
      firstAt: att?.first_at || null,
      lastAt: att?.last_at || null,
      spanMs,
      activeMs,
      gapMs: spanMs !== null ? Math.max(0, spanMs - activeMs) : null,
      apps: acts.map((a: any) => ({ app: a.app, ms: a.active_ms })),
      logged: Boolean(att?.logged_at),
    });
  }
  return out;
}

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

// Everyone who gets a device set up: the whole team except the admin (and not blocked). For the
// admin's device-setup panel.
export async function listTrainees() {
  const rows = await prisma.team_members.findMany({ where: { role: { not: 'admin' }, blocked: false }, orderBy: [{ team: 'asc' }, { email: 'asc' }], select: { email: true, name: true, team: true } });
  return rows.map((r: any) => ({ email: r.email, name: r.name, team: r.team }));
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

// The distinct outcomes of a device gate check, so a caller can tell completion, an unknown token and a
// backend failure apart (not just by the boolean lock).
export type GateStatus = 'invalid-token' | 'not-tracked' | 'before-window' | 'pending' | 'done' | 'error';
export type GateResult = { locked: boolean; status: GateStatus; name?: string; reason: string };

// The gate decision as a pure function of its inputs, so every branch is testable without a database.
// locked and reason are kept for existing callers; status is the machine-readable outcome.
//   email null                                  -> invalid-token (unlocked; an unknown token never locks)
//   no member, or admin                         -> not-tracked  (unlocked)
//   before 09:00 IST                            -> before-window (unlocked; the work-day window is 09:00+)
//   the gate could not be computed              -> error        (unlocked; fail open, but say so)
//   today's training not finished               -> pending      (locked)
//   today's training finished                   -> done         (unlocked)
export function gateDecision(input: {
  email: string | null;
  member: { role: string; name?: string | null } | null;
  istHour: number;
  gate?: { locked: boolean; error?: boolean };
  gateThrew?: boolean;
}): GateResult {
  if (!input.email) return { locked: false, status: 'invalid-token', reason: 'unknown token' };
  const m = input.member;
  if (!m || m.role === 'admin') return { locked: false, status: 'not-tracked', reason: 'not a tracked person' };
  const name = m.name || undefined;
  if (input.istHour < 9) return { locked: false, status: 'before-window', name, reason: 'before 09:00 IST' };
  if (input.gateThrew || !input.gate || input.gate.error) return { locked: false, status: 'error', name, reason: 'training status unavailable' };
  return input.gate.locked
    ? { locked: true, status: 'pending', name, reason: 'training pending' }
    : { locked: false, status: 'done', name, reason: 'training done' };
}

// IST hour (0-23) for the window check.
const istHourNow = () => new Date(Date.now() + 5.5 * 3600000).getUTCHours();

// The device lock gate, by work token. The laptop kiosk polls this: locked = true means keep the
// laptop on the lesson screen; false means free it. The lock only applies from 09:00 IST (the start of
// the work-day window); once today's training is done it stays false for the rest of the day, so a
// reboot does not re-lock. The admin and an unknown token are never locked. Fails open on any error,
// and status says which case it is (see gateDecision).
export async function gateForToken(token: string): Promise<GateResult> {
  try {
    const email = await emailForToken(token);
    const istHour = istHourNow();
    if (!email) return gateDecision({ email: null, member: null, istHour });
    const member = await prisma.team_members.findUnique({ where: { email }, select: { role: true, name: true } });
    let gate: { locked: boolean; error?: boolean } | undefined;
    let gateThrew = false;
    if (member && member.role !== 'admin' && istHour >= 9) {
      try {
        gate = await trainingGate(email, member.role);
      } catch {
        gateThrew = true;
      }
    }
    return gateDecision({ email, member, istHour, gate, gateThrew });
  } catch (e: any) {
    return { locked: false, status: 'error', reason: e?.message || 'gate check failed' };
  }
}

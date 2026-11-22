// Zoho Projects timesheet sync, decoupled from SEB exit. On confirmed Finished we ENQUEUE the person's
// prior worked days (not today); a separate processor (the scheduler/cron) drains the queue and posts
// each day's recorded hours under its own IST date to the team project's General task. Idempotent across
// retries and restarts: one queue row per (email, day), and work_attendance.logged_at is the ultimate
// key so a day already posted is never posted twice. The Zoho call is injected (deps) so this is tested
// with a mock and no live write.
import prismaClient from './prisma';
import { sqlNow } from './time';
import { istDay } from './topics';
import { PROJECT_BY_TEAM } from './zohoProjects';

const prisma: any = prismaClient;

export type SyncDeps = {
  // Posts `hours` for `day` to `projectId`'s General task; returns the Zoho log id; throws on timeout/error.
  logTime: (email: string, projectId: string, day: string, hours: number) => Promise<{ zohoLogId: string | null }>;
};

const parseMs = (s: any): number | null => {
  const t = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
};
const spanHours = (a: any, b: any): number => {
  const x = parseMs(a);
  const y = parseMs(b);
  const ms = x !== null && y !== null && y > x ? y - x : 0;
  return Math.round((ms / 3600000) * 100) / 100;
};

// Queue the person's PRIOR worked days (recorded work, not yet logged to Zoho). Skips today and days
// with no recorded work. Captures the project mapping in effect now (the team's current project). Fast
// and side-effect-light: it never calls Zoho, so SEB exit/desktop access do not depend on sync.
export async function enqueuePriorDays(email: string, today: string = istDay()): Promise<{ queued: number; reason?: string }> {
  const who = email.toLowerCase();
  const member = await prisma.team_members.findUnique({ where: { email: who }, select: { team: true, role: true } });
  if (!member || member.role === 'admin') return { queued: 0, reason: 'not a tracked person' };
  const projectId = member.team ? PROJECT_BY_TEAM[member.team] : null;
  if (!projectId) return { queued: 0, reason: `no project for team "${member.team || '(none)'}"` };
  const atts = await prisma.work_attendance.findMany({ where: { email: who, day: { lt: today }, logged_at: null } });
  let queued = 0;
  for (const a of atts) {
    if (spanHours(a.first_at, a.last_at) <= 0) continue; // skip days with no recorded work
    const existing = await prisma.timesheet_sync_queue.findUnique({ where: { email_day: { email: who, day: a.day } } });
    if (existing?.status === 'done') continue;
    await prisma.timesheet_sync_queue.upsert({
      where: { email_day: { email: who, day: a.day } },
      create: { email: who, day: a.day, project_id: projectId, status: 'pending' },
      update: { status: existing?.status === 'syncing' ? 'syncing' : 'pending', updated_at: sqlNow() }, // keep the first-captured project_id
    });
    queued++;
  }
  return { queued };
}

// Drain pending/failed queue rows. Called by the scheduler/cron with the live Zoho deps; tests pass a
// mock. Each day is posted under its own IST date to its captured project.
export async function processQueue(deps: SyncDeps, limit = 100) {
  const rows = await prisma.timesheet_sync_queue.findMany({ where: { status: { in: ['pending', 'failed'] } }, orderBy: { day: 'asc' }, take: limit });
  const out: any[] = [];
  for (const r of rows) out.push(await syncQueuedDay(r, deps));
  return out;
}

async function syncQueuedDay(r: any, deps: SyncDeps) {
  const where = { email_day: { email: r.email, day: r.day } };
  const att = await prisma.work_attendance.findUnique({ where });
  if (!att) return mark(r, 'skipped', 'no attendance recorded');
  if (att.logged_at) return mark(r, 'done', 'already logged', att.zoho_log_id); // idempotent: never re-post
  const hours = spanHours(att.first_at, att.last_at);
  if (hours <= 0) return mark(r, 'skipped', 'no recorded work');

  await prisma.timesheet_sync_queue.update({ where, data: { status: 'syncing', attempts: { increment: 1 }, updated_at: sqlNow() } });
  try {
    const res = await deps.logTime(r.email, r.project_id, r.day, hours);
    await prisma.work_attendance.update({ where, data: { logged_at: sqlNow(), zoho_log_id: res.zohoLogId || null } });
    return mark(r, 'done', null, res.zohoLogId, hours);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Uncertain outcome: reconcile before marking failed. If the day got logged (by this or a prior
    // attempt), it is done, not a duplicate.
    const re = await prisma.work_attendance.findUnique({ where });
    if (re?.logged_at) return mark(r, 'done', 'reconciled', re.zoho_log_id);
    return mark(r, 'failed', msg.slice(0, 200));
  }
}

async function mark(r: any, status: string, note: string | null, zohoLogId?: any, hours?: number) {
  const data: any = { status, note: note || null, updated_at: sqlNow() };
  if (zohoLogId !== undefined) data.zoho_log_id = zohoLogId;
  await prisma.timesheet_sync_queue.update({ where: { email_day: { email: r.email, day: r.day } }, data });
  return { email: r.email, day: r.day, project_id: r.project_id, status, hours, zohoLogId: zohoLogId ?? r.zoho_log_id, duplicate: note === 'already logged' || note === 'reconciled' };
}

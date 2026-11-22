// Idempotent attendance check-in: exactly one Zoho People punch per employee per IST day, safe against
// double-click, retry and restart. The Zoho calls are injected (deps) so this logic is testable with a
// mock and no live/paid Zoho. The state machine per (email, day):
//   none -> pending -> punching -> confirmed            (happy path)
//   punching --(timeout)--> pending                     (released; a retry reconciles before punching)
//   punching --(other error)--> failed                  (retryable)
// A second concurrent request that cannot claim the punch gets status "in_progress" and never punches.
import prismaClient from './prisma';
import { sqlNow } from './time';
import { istDay } from './topics';

const prisma: any = prismaClient;

export type Punch = { zohoId: string };
export type PunchDeps = {
  // Records a check-in in Zoho People; throws on timeout/error.
  punchIn: (email: string, day: string) => Promise<Punch>;
  // Reconcile: does Zoho People already have today's punch for this person? (used after a timed-out try)
  findPunch: (email: string, day: string) => Promise<Punch | null>;
  now?: () => number; // ms; for the stale-claim window (tests control it)
};
export type CheckInResult = {
  status: 'confirmed' | 'in_progress' | 'pending' | 'failed';
  zohoId?: string | null;
  duplicate?: boolean; // the punch already existed (idempotent replay)
  retryable?: boolean;
  reason?: string;
};

// A claimed ("punching") row older than this is assumed abandoned (the owner crashed or its request
// died) and may be reclaimed by a later check-in.
const STALE_MS = 30_000;
const toSql = (ms: number) => sqlNow(new Date(ms));

export async function checkIn(email: string, deps: PunchDeps, day: string = istDay()): Promise<CheckInResult> {
  const who = email.toLowerCase();
  const now = deps.now ? deps.now() : Date.now();

  // 1. Idempotency key = (email, day). Create the row once; a concurrent create is ignored.
  await prisma.attendance_punches.create({ data: { email: who, day, status: 'pending' } }).catch(() => {});
  const row = await prisma.attendance_punches.findUnique({ where: { email_day: { email: who, day } } });
  if (row?.status === 'confirmed') return { status: 'confirmed', zohoId: row.zoho_id, duplicate: true };
  const priorAttempts = row?.attempts || 0;

  // 2. Claim: atomically move a pending (or stale punching, or failed) row to 'punching'. Only one
  // request wins; everyone else gets "in_progress" and does not punch.
  const claim = await prisma.attendance_punches.updateMany({
    where: {
      email: who,
      day,
      OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'punching', attempt_at: { lt: toSql(now - STALE_MS) } }],
    },
    data: { status: 'punching', attempt_at: toSql(now), attempts: { increment: 1 }, updated_at: sqlNow() },
  });
  if (claim.count === 0) {
    const cur = await prisma.attendance_punches.findUnique({ where: { email_day: { email: who, day } } });
    if (cur?.status === 'confirmed') return { status: 'confirmed', zohoId: cur.zoho_id, duplicate: true };
    return { status: 'in_progress', reason: 'another check-in is in progress' };
  }

  // 3. If a previous attempt may have reached Zoho before dying, reconcile before punching again.
  if (priorAttempts > 0) {
    const found = await deps.findPunch(who, day).catch(() => null);
    if (found) {
      await confirm(who, day, found.zohoId);
      return { status: 'confirmed', zohoId: found.zohoId, duplicate: true };
    }
  }

  // 4. Punch.
  try {
    const res = await deps.punchIn(who, day);
    await confirm(who, day, res.zohoId);
    return { status: 'confirmed', zohoId: res.zohoId };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const timeout = /timeout|timed ?out|ETIMEDOUT|ECONNRESET|aborted|AbortError/i.test(msg);
    // Timeout: release to 'pending' so a retry reconciles first (Zoho may have recorded it). Other
    // errors: 'failed' (still retryable). Never punch twice for the same day.
    await prisma.attendance_punches.update({
      where: { email_day: { email: who, day } },
      data: { status: timeout ? 'pending' : 'failed', note: msg.slice(0, 200), updated_at: sqlNow() },
    });
    return { status: timeout ? 'pending' : 'failed', retryable: true, reason: timeout ? 'Zoho timed out; it will reconcile on the next check-in' : msg };
  }
}

async function confirm(email: string, day: string, zohoId: string | null) {
  await prisma.attendance_punches.update({ where: { email_day: { email, day } }, data: { status: 'confirmed', zoho_id: zohoId || null, updated_at: sqlNow() } });
}

export async function attendanceStatus(email: string, day: string = istDay()): Promise<{ status: string; zohoId?: string | null }> {
  const row = await prisma.attendance_punches.findUnique({ where: { email_day: { email: email.toLowerCase(), day } } });
  return row ? { status: row.status, zohoId: row.zoho_id } : { status: 'none' };
}

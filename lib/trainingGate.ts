// The daily training gate: for a person in the training (everyone but the admin, with an active
// profile), while today's training is not finished (a lesson of today not marked read, or a test of
// today not submitted), every dashboard page except Team Training is locked and their API
// writes outside the training are refused (proxy.ts). It fails open: with no lesson and no test for
// today (lessons not made yet, Testing mode, AI paused, an error), nobody is locked out; a notice says
// so instead. The admin's "In training" switch (active) removes the gate for a person.
import prismaClient from './prisma';
import { TRACK_LABEL, isTrainee, lessonIdsOf, type Track } from './trainingContent';

// Untyped on purpose: the Prisma query types of these many queries push the build's type check past
// its memory limit (see lib/assistant/tabTools.ts). The tests cover the queries.
const prisma: any = prismaClient;

const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

export const GATE_MESSAGE = "Finish today's training to open the dashboard";
// error is set only when the gate could not be computed (a backend failure). It is optional and
// defaults to absent, so existing callers that read locked/unread/openTests/notice are unaffected;
// callers that need to tell "could not check" from "nothing to do" (the device gate) read it.
export type Gate = { locked: boolean; unread: { id: number; title: string; track: string }[]; openTests: { id: number; kind: string }[]; notice: string | null; error?: boolean; openReason?: OpenReason };
const OPEN: Gate = { locked: false, unread: [], openTests: [], notice: null };

// Why the gate is open (not locked), when it is not locked: the day's training is done, it is
// expected today but not generated yet, or no training is scheduled today. Optional and only set when
// locked is false, so existing callers that read locked/unread/openTests/notice are unaffected.
export type OpenReason = 'done' | 'not-ready' | 'no-training';
export function openReasonFor(scheduled: boolean, generated: boolean): OpenReason {
  if (!scheduled) return 'no-training';
  if (!generated) return 'not-ready';
  return 'done';
}

// Cached 30 seconds per person (the proxy asks on every API write); shared across bundles through
// globalThis so marking a lesson read or submitting a test unlocks at once.
const g = globalThis as unknown as { __trainingGate?: Map<string, { at: number; day: string; value: Gate }> };
const cache = (g.__trainingGate ||= new Map());
export const forgetGate = (email?: string) => (email ? cache.delete(email.toLowerCase()) : cache.clear());

export async function trainingGate(email: string, role: string, day = istDay()): Promise<Gate> {
  const e = String(email || '').toLowerCase();
  if (!e || !isTrainee(role)) return OPEN;
  const hit = cache.get(e);
  if (hit && hit.day === day && Date.now() - hit.at < 30_000) return hit.value;
  // A backend failure is reported (error: true), not cached, and not silently treated as "nothing to
  // do": a caller that acts on the gate can tell it apart from a real completion.
  const value = await computeGate(e, day).catch(() => ({ ...OPEN, error: true }));
  if (!value.error) {
    cache.set(e, { at: Date.now(), day, value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return value;
}

// Lessons and tests made at or after this hour (IST) on their day, because AI work was paused, in
// Testing mode or failed earlier, do not lock that day: the person is told, and the gate starts the
// next day. Lessons and tests from before the training's second version (no lesson extras, a test
// with no lesson list) never lock, so the day this version goes live nobody is locked mid-work.
export const GATE_CUTOFF_HOUR_IST = 13;
export function madeLate(createdAt: string | null | undefined, day: string): boolean {
  const ms = Date.parse(String(createdAt || '').replace(' ', 'T') + (/[zZ]$/.test(String(createdAt || '')) ? '' : 'Z'));
  if (!Number.isFinite(ms)) return false;
  const ist = new Date(ms + 5.5 * 3600000);
  const d = ist.toISOString().slice(0, 10);
  return d > day || (d === day && ist.getUTCHours() >= GATE_CUTOFF_HOUR_IST);
}

async function computeGate(email: string, day: string): Promise<Gate> {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  if (!p || !p.active) return OPEN;
  // A blocked person cannot submit anything, so they are never locked.
  const member = await prisma.team_members.findUnique({ where: { email }, select: { blocked: true } });
  if (member?.blocked) return OPEN;
  const ids = Object.values(lessonIdsOf(p)).filter((x): x is number => Boolean(x));
  const all = ids.length ? await prisma.training_lessons.findMany({ where: { id: { in: ids }, day, extras: { not: null } }, select: { id: true, title: true, track: true, created_at: true } }) : [];
  const tests = await prisma.training_tests.findMany({ where: { email, day, status: 'open', lesson_ids: { not: null } }, select: { id: true, kind: true, created_at: true } });
  const todays = all.filter((l: any) => !madeLate(l.created_at, day));
  const late = all.length - todays.length + tests.filter((t: any) => madeLate(t.created_at, day)).length;
  const read = new Set((await prisma.training_reads.findMany({ where: { email, lesson_id: { in: todays.map((l: any) => l.id) } }, select: { lesson_id: true } })).map((r: any) => r.lesson_id));
  const unread = todays.filter((l: any) => !read.has(l.id)).map((l: any) => ({ id: l.id, title: l.title, track: TRACK_LABEL[l.track as Track] || l.track }));
  const openTests = tests.filter((t: any) => !madeLate(t.created_at, day)).map((t: any) => ({ id: t.id, kind: t.kind }));
  // Whether training is expected today (per the schedule) and whether it has been generated. These let
  // an unlocked gate say "done" vs "not generated yet" (not-ready) vs "no training today".
  const { getSchedule, isLessonDay, isTestDay } = await import('./trainingSchedule');
  const sched = await getSchedule();
  const scheduled = isLessonDay(day, sched) || isTestDay(day, sched);
  const generated = all.length > 0 || tests.length > 0;
  const locked = unread.length > 0 || openTests.length > 0;
  if (locked) return { locked, unread, openTests, notice: null };
  const openReason = openReasonFor(scheduled, generated);
  if (late) return { ...OPEN, openReason, notice: `Today's training was ready late (after ${GATE_CUTOFF_HOUR_IST}:00 IST), so it does not lock the dashboard today. Please do it today; from tomorrow the dashboard waits for it again.` };
  if (!generated) return { ...OPEN, openReason, notice: scheduled ? "Today's training is not ready yet (lessons are made early each morning, and wait while AI work is paused or in Testing mode). The dashboard stays open meanwhile." : null };
  return { ...OPEN, openReason };
}

// API paths a locked person may still write to: the training itself (sign-in and sign-out are public).
export const allowedWhileLocked = (path: string) => /^\/api\/associate-training(\/|$)/.test(path) || /^\/api\/consent(\/|$)/.test(path) || /^\/api\/auth(\/|$)/.test(path);

// proxy.ts: the refusal for an API write by a person whose training today is not finished, or null.
// Reads stay open (the page shows the lock); the training's own routes stay open.
export async function gateRefusal(method: string, path: string, email: string | null | undefined, role: string, day?: string): Promise<{ status: number; body: any } | null> {
  const write = method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
  if (!write || !email || !isTrainee(role) || allowedWhileLocked(path)) return null;
  const gate = await trainingGate(email, role, day);
  return gate.locked ? { status: 403, body: { error: `${GATE_MESSAGE}: ${[gate.unread.length ? `read ${gate.unread.length} lesson(s)` : '', gate.openTests.length ? `submit ${gate.openTests.length} test(s)` : ''].filter(Boolean).join(' and ')} on Team Training.`, trainingGate: true } } : null;
}

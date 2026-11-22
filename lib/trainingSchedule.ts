// The training rhythm.
//
// Week 1 (the launch week, the week of training_pattern_start): two tests, on Wednesday and Saturday,
// lessons on the other working days.
// Week 2 onward: still two tests a week, but on two UNANNOUNCED days chosen per person per week (not
// the same day for everyone, not a fixed day). Lessons on the other working days.
// A day is a lesson day OR a test day, never both. Sunday is off (no lesson, no test).
// Once a month (from training_grand_start), the last Tuesday of the month is a GRAND test for everyone
// on everything learned so far; that day is a test day (no lesson, no weekly test).
//
// Controlled by three settings (dates, YYYY-MM-DD), with the defaults below:
//   training_pattern_start  - the Monday the rhythm begins (week 1 = this week; before it: lessons only)
//   training_surprise_start - kept for compatibility; the random test days begin the week after week 1
//   training_grand_start    - the first day from which the monthly grand test runs (defaults to next month)
// Set training_pattern_start to an empty string to turn the schedule off and go back to a lesson and a
// test every day (the old behaviour; this is what the DB tests use).
import crypto from 'crypto';

export const DEFAULT_PATTERN_START = '2026-11-23'; // Monday
export const DEFAULT_SURPRISE_START = '2026-11-30'; // the Monday after
export const DEFAULT_GRAND_START = '2026-12-01'; // next month: the monthly grand test starts then
const LESSON_DOW = [1, 2, 4, 5]; // Mon, Tue, Thu, Fri (used only for the old shared helpers)
const TEST_DOW = [3, 6]; // Wed, Sat (week 1, and the old shared helpers)
const WORK_DOW = [1, 2, 3, 4, 5, 6]; // Mon..Sat (Sunday off)

const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
// The Monday (YYYY-MM-DD) of the week containing day.
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type Schedule = { on: boolean; patternStart: string; surpriseStart: string; grandStart: string };

export async function getSchedule(): Promise<Schedule> {
  const settings = await import('./settings');
  const patternStart = String((await settings.get('training_pattern_start')) ?? DEFAULT_PATTERN_START).trim();
  const surpriseStart = String((await settings.get('training_surprise_start')) ?? DEFAULT_SURPRISE_START).trim();
  const grandStart = String((await settings.get('training_grand_start')) ?? DEFAULT_GRAND_START).trim();
  return { on: Boolean(patternStart), patternStart, surpriseStart, grandStart };
}

// --- The old shared helpers (kept for the gate's "is this a working day" check and existing tests).
// isLessonDay OR isTestDay is still exactly "a non-Sunday working day", which is all the gate needs.
export function isLessonDay(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  const d = dow(day);
  if (d === 0) return false;
  if (day < s.patternStart) return true;
  return LESSON_DOW.includes(d);
}
export function isTestDay(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  if (day < s.patternStart) return false;
  return TEST_DOW.includes(dow(day));
}
export function surpriseOn(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  return Boolean(s.surpriseStart) && day >= s.surpriseStart;
}

// --- The per-person rhythm that actually drives what each person gets each day. ---

// The Tuesday of day's week, and (if the monthly grand test falls that week) that grand day.
function tuesdayOfWeek(day: string): string {
  const d = new Date(`${mondayOf(day)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function grandDayOfWeek(day: string, s: Schedule): string | null {
  const tue = tuesdayOfWeek(day);
  return isGrandTestDay(tue, s) ? tue : null;
}

// The NORMAL (weekly) test weekday numbers (1=Mon..6=Sat) for this person's week. Week 1 is fixed to
// Wed + Sat; later weeks are unannounced days, stable within the week, keyed with the server secret.
// A week that holds the monthly grand test gets only ONE normal test (the grand is the second), so the
// week still has exactly two tests. The grand day (a Tuesday) is never also a normal test day.
export function testWeekdaysFor(email: string, day: string, s: Schedule, secret = process.env.NEXTAUTH_SECRET || 'training'): number[] {
  const ws = mondayOf(day);
  const grandTue = grandDayOfWeek(day, s); // non-null only in the grand week
  if (ws === mondayOf(s.patternStart) && !grandTue) return [...TEST_DOW]; // week 1: Wed + Sat
  const count = grandTue ? 1 : 2; // grand week: one normal test + the grand
  const pool = grandTue ? WORK_DOW.filter((d) => d !== 2) : [...WORK_DOW]; // exclude Tuesday (the grand day)
  const h = crypto.createHmac('sha256', secret).update(`test|${email.toLowerCase()}|${ws}`).digest();
  const first = pool[h[0] % pool.length];
  if (count === 1) return [first];
  let second = pool[h[1] % pool.length];
  if (second === first) second = pool[(pool.indexOf(first) + 1) % pool.length];
  return [first, second].sort((a, b) => a - b);
}

// Is day one of this person's two test days this week? (Sunday never; before the launch never; schedule
// off = a test every day, the old behaviour.)
export function isTestDayFor(email: string, day: string, s: Schedule, secret?: string): boolean {
  if (!s.on) return true;
  if (dow(day) === 0) return false;
  if (day < s.patternStart) return false;
  return testWeekdaysFor(email, day, s, secret).includes(dow(day));
}

// A lesson day for this person: a non-Sunday working day that is not one of their test days. (Schedule
// off = a lesson every day, the old behaviour.)
export function isLessonDayFor(email: string, day: string, s: Schedule, secret?: string): boolean {
  if (!s.on) return true;
  if (dow(day) === 0) return false;
  if (isGrandTestDay(day, s)) return false; // the grand test day is test-only
  return !isTestDayFor(email, day, s, secret);
}

// The monthly grand test: the last Tuesday of the month, from grandStart onward. Same day for everyone.
function isLastTuesdayOfMonth(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  if (d.getUTCDay() !== 2) return false; // Tuesday
  const nextWeek = new Date(d);
  nextWeek.setUTCDate(d.getUTCDate() + 7);
  return nextWeek.getUTCMonth() !== d.getUTCMonth(); // no Tuesday next week in the same month
}
export function isGrandTestDay(day: string, s: Schedule): boolean {
  if (!s.on || !s.grandStart || day < s.grandStart) return false;
  return isLastTuesdayOfMonth(day);
}

// The test dates (YYYY-MM-DD) in the week containing day, for the admin/manager view only (never the
// employee's). Normal test days plus the grand test day, if any.
export function testDatesForWeek(email: string, day: string, s: Schedule, secret?: string): string[] {
  const mon = mondayOf(day);
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(`${mon}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i); // Mon..Sat
    const ds = d.toISOString().slice(0, 10);
    if (isTestDayFor(email, ds, s, secret) || isGrandTestDay(ds, s)) out.push(ds);
  }
  return out;
}

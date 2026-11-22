import test from 'node:test';
import assert from 'node:assert/strict';

// Pure functions, but they live in modules that import the Prisma client at load (throws without
// DATABASE_URL). Set a dummy URL first; no connection is made (no queries run here).
process.env.DATABASE_URL ||= 'postgresql://user:pass@127.0.0.1:5432/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateDecision, GATE_LOCK_HOUR_IST } = require('../lib/worklog') as typeof import('../lib/worklog');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openReasonFor } = require('../lib/trainingGate') as typeof import('../lib/trainingGate');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isLessonDay, isTestDay } = require('../lib/trainingSchedule') as typeof import('../lib/trainingSchedule');

const trainee = { role: 'user', name: 'Krati' };
const sched = { on: true, patternStart: '2026-11-23', surpriseStart: '2026-11-30' };
const scheduledDay = (day: string) => isLessonDay(day, sched) || isTestDay(day, sched);

// --- openReasonFor: the new discriminator (fake generator state = the `generated` flag) ---
test('openReasonFor: scheduled + generated -> done', () => assert.equal(openReasonFor(true, true), 'done'));
test('openReasonFor: scheduled + NOT generated -> not-ready', () => assert.equal(openReasonFor(true, false), 'not-ready'));
test('openReasonFor: NOT scheduled -> no-training (generated or not)', () => {
  assert.equal(openReasonFor(false, false), 'no-training');
  assert.equal(openReasonFor(false, true), 'no-training');
});

// Real schedule: a training day vs a rest day (explicit "no training scheduled" case).
test('schedule: Mon/Wed are training days, Sunday is not', () => {
  assert.equal(scheduledDay('2026-11-23'), true);  // Monday (lesson day)
  assert.equal(scheduledDay('2026-11-25'), true);  // Wednesday (test day)
  assert.equal(scheduledDay('2026-11-22'), false); // Sunday: no training scheduled
});

// --- gateDecision: new statuses at 09:00, existing locked behavior preserved ---
const at9 = (over: Record<string, unknown>) =>
  gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST, gate: { locked: false, ...over } });

test('09:00 missing (expected but not generated): not-ready, locked false', () => {
  const r = at9({ openReason: 'not-ready' });
  assert.equal(r.status, 'not-ready');
  assert.equal(r.locked, false);
});

test('09:00 no training scheduled today (real Sunday): no-training, locked false', () => {
  const openReason = openReasonFor(scheduledDay('2026-11-22'), false);
  const r = at9({ openReason });
  assert.equal(r.status, 'no-training');
  assert.equal(r.locked, false);
});

test('done only when training available AND complete', () => {
  const r = at9({ openReason: 'done' });
  assert.equal(r.status, 'done');
  assert.equal(r.locked, false);
});

test('09:00 partially ready / unread (something still open): pending, locked true', () => {
  const r = gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST, gate: { locked: true } });
  assert.equal(r.status, 'pending');
  assert.equal(r.locked, true);
});

test('08:59 before-window regardless of openReason', () => {
  const r = gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST - 1, gate: { locked: false, openReason: 'not-ready' } });
  assert.equal(r.status, 'before-window');
  assert.equal(r.locked, false);
});

test('backend error stays error (not done, not not-ready)', () => {
  const r = gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST, gateThrew: true });
  assert.equal(r.status, 'error');
  assert.equal(r.locked, false);
});

test('not-ready, no-training, done and error are four distinct statuses', () => {
  const notReady = at9({ openReason: 'not-ready' }).status;
  const noTraining = at9({ openReason: 'no-training' }).status;
  const done = at9({ openReason: 'done' }).status;
  const err = gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST, gateThrew: true }).status;
  assert.equal(new Set([notReady, noTraining, done, err]).size, 4);
});

test('backward compatible: an unlocked gate with no openReason defaults to done', () => {
  const r = gateDecision({ email: 'k@x', member: trainee, istHour: GATE_LOCK_HOUR_IST, gate: { locked: false } });
  assert.equal(r.status, 'done');
  assert.equal(r.locked, false);
});

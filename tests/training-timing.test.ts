import test from 'node:test';
import assert from 'node:assert/strict';

// Both modules import the Prisma client at load (throws without DATABASE_URL). Set a dummy URL first;
// no connection is made (these are pure values / a pure function).
process.env.DATABASE_URL ||= 'postgresql://user:pass@127.0.0.1:5432/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateDecision, GATE_LOCK_HOUR_IST } = require('../lib/worklog') as typeof import('../lib/worklog');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TRAINING_HOUR_IST } = require('../lib/associateTraining') as typeof import('../lib/associateTraining');

const trainee = { role: 'user', name: 'Krati' };
const pending = { locked: true };
const finished = { locked: false };

// The fix: training is generated before the lock window opens, so it is ready before 09:00.
test('generation hour is strictly before the lock hour (training ready before 09:00)', () => {
  assert.ok(
    TRAINING_HOUR_IST < GATE_LOCK_HOUR_IST,
    `generation hour (${TRAINING_HOUR_IST}) must be before the lock hour (${GATE_LOCK_HOUR_IST})`,
  );
});

test('08:59 IST: before-window, not locked', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: GATE_LOCK_HOUR_IST - 1, gate: pending });
  assert.equal(r.status, 'before-window');
  assert.equal(r.locked, false);
});

test('09:00 IST with ready, unread training: pending, locked', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: GATE_LOCK_HOUR_IST, gate: pending });
  assert.equal(r.status, 'pending');
  assert.equal(r.locked, true);
});

test('after lesson read and the required test Finished: done, unlocked', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 10, gate: finished });
  assert.equal(r.status, 'done');
  assert.equal(r.locked, false);
});

// Missing lessons: expected today but not generated -> not-ready (unlocked, fail open). This is the
// case the timing fix reduces by generating before 09:00.
test('lesson missing / not generated yet: not-ready, not locked', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: GATE_LOCK_HOUR_IST, gate: { locked: false, openReason: 'not-ready' } });
  assert.equal(r.status, 'not-ready');
  assert.equal(r.locked, false);
});

// Reported behavior for a backend failure: distinct error, still fails open.
test('backend error: error status, not a false done, not locked', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 10, gateThrew: true });
  assert.equal(r.status, 'error');
  assert.equal(r.locked, false);
});

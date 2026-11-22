import test from 'node:test';
import assert from 'node:assert/strict';

// gateDecision is a pure function, but it lives in lib/worklog, which imports the Prisma client at
// load time and that throws without DATABASE_URL. Set a dummy URL first (no connection is made:
// gateDecision runs no queries), then require it so the env var is in place before the import runs.
process.env.DATABASE_URL ||= 'postgresql://user:pass@127.0.0.1:5432/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gateDecision } = require('../lib/worklog') as typeof import('../lib/worklog');

const trainee = { role: 'user', name: 'Krati' };

// 09:00 IST window boundary.
test('before 09:00 IST: not locked, before-window', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 8, gate: { locked: true } });
  assert.equal(r.locked, false);
  assert.equal(r.status, 'before-window');
});

test('at 09:00 IST with training pending: locked, pending', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 9, gate: { locked: true } });
  assert.equal(r.locked, true);
  assert.equal(r.status, 'pending');
});

// Pending vs finished.
test('after 09:00 with training still pending: locked, pending', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: true } });
  assert.equal(r.locked, true);
  assert.equal(r.status, 'pending');
});

test('after the lesson/test is Finished: not locked, done', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: false } });
  assert.equal(r.locked, false);
  assert.equal(r.status, 'done');
});

// Invalid token.
test('invalid token: not locked, invalid-token', () => {
  const r = gateDecision({ email: null, member: null, istHour: 14 });
  assert.equal(r.locked, false);
  assert.equal(r.status, 'invalid-token');
});

// Backend / status-check failure, both ways it can arrive.
test('backend error (trainingGate threw): not locked, error', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gateThrew: true });
  assert.equal(r.locked, false);
  assert.equal(r.status, 'error');
});

test('backend error (gate.error flag from a failed compute): error', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: false, error: true } });
  assert.equal(r.status, 'error');
});

test('missing gate result (nothing computed): error, not a false "done"', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: undefined });
  assert.equal(r.status, 'error');
});

// The core of the ask: a status-check failure must be distinguishable from a real completion, even
// though both leave the laptop unlocked (fail open).
test('error is distinct from done: same locked, different status', () => {
  const done = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: false } });
  const err = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gateThrew: true });
  assert.equal(done.locked, err.locked);
  assert.notEqual(done.status, err.status);
});

test('all three target states are distinct statuses', () => {
  const done = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: false } }).status;
  const invalid = gateDecision({ email: null, member: null, istHour: 14 }).status;
  const fail = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gateThrew: true }).status;
  assert.equal(new Set([done, invalid, fail]).size, 3);
});

// Admin / not-tracked, and that the person's name and the old fields are carried through.
test('admin is never locked: not-tracked', () => {
  const r = gateDecision({ email: 'boss@x.com', member: { role: 'admin', name: 'Boss' }, istHour: 14, gate: { locked: true } });
  assert.equal(r.locked, false);
  assert.equal(r.status, 'not-tracked');
});

test('name is carried through for a tracked person', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 14, gate: { locked: true } });
  assert.equal(r.name, 'Krati');
});

test('backward compatible: locked and reason are still present', () => {
  const r = gateDecision({ email: 'k@x.com', member: trainee, istHour: 9, gate: { locked: true } });
  assert.equal(typeof r.locked, 'boolean');
  assert.equal(typeof r.reason, 'string');
});

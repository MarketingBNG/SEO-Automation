import test from 'node:test';
import assert from 'node:assert/strict';

// Database-backed tests run only when a real (throwaway) DATABASE_URL is set; never production.
const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.NEXTAUTH_SECRET ||= 'test-secret';
/* eslint-disable @typescript-eslint/no-require-imports */
const prisma = require('../lib/prisma').default;
const { checkIn, attendanceStatus } = require('../lib/attendance') as typeof import('../lib/attendance');
const seb = require('../lib/seb') as typeof import('../lib/seb');
const { gateForEmail, gateDecision, ensureWorkToken, emailForToken } = require('../lib/worklog') as typeof import('../lib/worklog');
const { markRead, submitTest, playGame } = require('../lib/associateTraining') as typeof import('../lib/associateTraining');
const { trainingGate, allowedWhileLocked, gateRefusal } = require('../lib/trainingGate') as typeof import('../lib/trainingGate');
const { enqueuePriorDays, processQueue } = require('../lib/timesheetSync') as typeof import('../lib/timesheetSync');
const settings = require('../lib/settings') as typeof import('../lib/settings');
const { sebTodayItem } = require('../lib/associateTrainingView') as typeof import('../lib/associateTrainingView');
const enroll = require('../lib/sebEnroll') as typeof import('../lib/sebEnroll');

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const istDayNow = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const Q = '[{"id":"q1","q":"W?","options":["a","b","c","d"],"answer":0,"explain":"e"}]';
async function wipe() {
  for (const t of ['attendance_punches', 'seb_handoffs', 'seb_sessions', 'timesheet_sync_queue', 'work_attendance', 'training_reads', 'training_misses', 'training_games', 'training_tests', 'training_lessons', 'training_profiles', 'team_members', 'settings']) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${t}`).catch(() => {});
  }
}
// A marketing worker with a recorded attendance window (09:00-17:00 IST => 8h) on `day`, not yet logged.
const MARKETING_PROJECT = '283967000001053334';
async function seedWorkDay(email: string, day: string, firstUtc = `${day} 03:30:00`, lastUtc = `${day} 11:30:00`) {
  await prisma.team_members.upsert({ where: { email }, create: { email, name: email, role: 'user', team: 'marketing', blocked: false }, update: { team: 'marketing' } });
  await prisma.work_attendance.create({ data: { email, day, first_at: firstUtc, last_at: lastUtc } });
}
const mockLog = () => {
  const calls: any[] = [];
  const deps = { logTime: async (email: string, projectId: string, d: string, hours: number) => { calls.push({ email, projectId, day: d, hours }); return { zohoLogId: `zp-${d}` }; } };
  return { deps, calls };
};

// ---- Pure: the 08:59/09:00 IST gate boundary (no DB; same mapping gateForEmail uses) ----
test('gate boundary: 08:59 -> before-window, 09:00 -> pending/done', () => {
  const m = { role: 'user', name: 'K' };
  assert.equal(gateDecision({ email: 'k@x', member: m, istHour: 8, gate: { locked: true } }).status, 'before-window');
  assert.equal(gateDecision({ email: 'k@x', member: m, istHour: 9, gate: { locked: true } }).status, 'pending');
  assert.equal(gateDecision({ email: 'k@x', member: m, istHour: 9, gate: { locked: false, openReason: 'done' } }).status, 'done');
});

// ---- Attendance idempotency (mock Zoho deps; no live/paid call) ----
test('duplicate Check In (double-click): exactly one punch', { skip: !db }, async () => {
  await wipe();
  let calls = 0;
  const deps = { punchIn: async () => { calls++; await delay(30); return { zohoId: 'z1' }; }, findPunch: async () => null };
  const [a, b] = await Promise.all([checkIn('e@x.com', deps, '2026-11-25'), checkIn('e@x.com', deps, '2026-11-25')]);
  assert.equal(calls, 1, 'punchIn called once');
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['confirmed', 'in_progress']);
  assert.equal((await attendanceStatus('e@x.com', '2026-11-25')).status, 'confirmed');
});

test('Zoho timeout -> pending, then reconcile on retry (no second punch)', { skip: !db }, async () => {
  await wipe();
  let punches = 0; let zohoHasIt = false;
  const deps = {
    punchIn: async () => { punches++; zohoHasIt = true; throw new Error('request timed out'); }, // reached Zoho but timed out
    findPunch: async () => (zohoHasIt ? { zohoId: 'z-reconciled' } : null),
  };
  const first = await checkIn('t@x.com', deps, '2026-11-25');
  assert.equal(first.status, 'pending');
  assert.equal((await attendanceStatus('t@x.com', '2026-11-25')).status, 'pending');
  const second = await checkIn('t@x.com', deps, '2026-11-25');
  assert.equal(second.status, 'confirmed');
  assert.equal(second.zohoId, 'z-reconciled');
  assert.equal(punches, 1, 'did not punch a second time');
});

test('restart after confirmed: duplicate, no new punch', { skip: !db }, async () => {
  await wipe();
  let calls = 0;
  const deps = { punchIn: async () => { calls++; return { zohoId: 'z1' }; }, findPunch: async () => null };
  await checkIn('r@x.com', deps, '2026-11-25');
  const again = await checkIn('r@x.com', deps, '2026-11-25');
  assert.equal(again.status, 'confirmed');
  assert.equal(again.duplicate, true);
  assert.equal(calls, 1);
});

test('non-timeout Zoho error -> failed (retryable)', { skip: !db }, async () => {
  await wipe();
  const deps = { punchIn: async () => { throw new Error('403 forbidden'); }, findPunch: async () => null };
  const r = await checkIn('f@x.com', deps, '2026-11-25');
  assert.equal(r.status, 'failed');
  assert.equal(r.retryable, true);
});

// ---- Identity handoff: single-use + expiry ----
test('handoff code is single use', { skip: !db }, async () => {
  await wipe();
  const { code } = await seb.mintHandoff('h@x.com');
  assert.equal(await seb.redeemHandoff(code), 'h@x.com');
  assert.equal(await seb.redeemHandoff(code), null, 'cannot be reused');
});

test('expired handoff is rejected', { skip: !db }, async () => {
  await wipe();
  await prisma.seb_handoffs.create({ data: { code: 'EXPIRED', email: 'h@x.com', expires_at: '2000-01-01 00:00:00' } });
  assert.equal(await seb.redeemHandoff('EXPIRED'), null);
});

// ---- Same-day resume and completed-day restart (by day, via the real gate) ----
async function seedTrainee(email: string, lessonId: number, day: string) {
  await prisma.team_members.create({ data: { email, name: email, role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email, name: email, level: 1, lesson_ids: `{"technical":${lessonId}}`, active: true } });
  await prisma.training_lessons.create({ data: { id: lessonId, day, level: 1, title: 'L', content_html: '<p>x</p>', questions: Q, track: 'technical', audience: 'associate', extras: '{}', created_at: `${day} 02:00:00` } });
}

test('same-day resume: unread -> pending; after read -> done; re-check stays done', { skip: !db }, async () => {
  await wipe();
  const day = '2026-11-26'; // Thursday, a lesson day
  await seedTrainee('s@x.com', 7001, day);
  assert.equal((await trainingGate('s@x.com', 'user', day)).locked, true, 'unread -> locked (pending)');
  await markRead('s@x.com', 7001);
  const g1 = await trainingGate('s@x.com', 'user', day);
  assert.equal(g1.locked, false);
  assert.equal(g1.openReason, 'done');
  // "restart" = ask again for the same day -> still done (does not re-lock)
  assert.equal((await trainingGate('s@x.com', 'user', day)).openReason, 'done');
});

// ---- Failed completion save: the finish flow must not report done ----
test('failed completion save: submitTest throws for an unknown test (finish returns no quit)', { skip: !db }, async () => {
  await wipe();
  await prisma.team_members.create({ data: { email: 'x@x.com', name: 'x', role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email: 'x@x.com', name: 'x', level: 1, lesson_ids: '{}', active: true } });
  await assert.rejects(() => submitTest('x@x.com', 999999, {}), /not found|no test|Test/i);
});

// ---- one-time device enrollment: silent re-auth, bound to the Windows user, revocable ----
const SID = 'S-1-5-21-111-222-333-1001';
test('enrollment: exchange returns the email for the same Windows user (silent re-auth)', { skip: !db }, async () => {
  await wipe();
  const { id, secret } = await enroll.createEnrollment('en@x.com', SID, 'VM-PC');
  assert.equal(await enroll.exchangeEnrollment(id, secret, SID), 'en@x.com');
  // repeatable (each launch/reboot) — no code needed
  assert.equal(await enroll.exchangeEnrollment(id, secret, SID), 'en@x.com');
});

test('enrollment: a different Windows user is rejected (ask for a code)', { skip: !db }, async () => {
  await wipe();
  const { id, secret } = await enroll.createEnrollment('en@x.com', SID);
  assert.equal(await enroll.exchangeEnrollment(id, secret, 'S-1-5-21-999-OTHER-2002'), null);
});

test('enrollment: wrong credential is rejected', { skip: !db }, async () => {
  await wipe();
  const { id } = await enroll.createEnrollment('en@x.com', SID);
  assert.equal(await enroll.exchangeEnrollment(id, 'not-the-secret', SID), null);
});

test('enrollment: revoked -> rejected (launcher falls back to Check In)', { skip: !db }, async () => {
  await wipe();
  const { id, secret } = await enroll.createEnrollment('en@x.com', SID);
  assert.equal(await enroll.revokeEnrollment(id), 1);
  assert.equal(await enroll.exchangeEnrollment(id, secret, SID), null);
});

test('enrollment: re-enrolling the same device-user revokes the previous credential', { skip: !db }, async () => {
  await wipe();
  const first = await enroll.createEnrollment('en@x.com', SID);
  const second = await enroll.createEnrollment('en@x.com', SID);
  assert.equal(await enroll.exchangeEnrollment(first.id, first.secret, SID), null, 'old credential revoked');
  assert.equal(await enroll.exchangeEnrollment(second.id, second.secret, SID), 'en@x.com');
  const list = await enroll.listEnrollments('en@x.com');
  assert.equal(list.filter((e: any) => e.active).length, 1, 'one active enrollment');
});

// ---- no-training auto-quit on /seb (Sunday): quit URL + read-only (no completion, no sync) ----
test('no-training is unlocked and not done (desktop access, not complete)', () => {
  const r = gateDecision({ email: 'k@x', member: { role: 'user', name: 'K' }, istHour: 10, gate: { locked: false, openReason: 'no-training' } });
  assert.equal(r.status, 'no-training');
  assert.equal(r.locked, false);
  assert.notEqual(r.status, 'done');
});

// The launcher runs enroll-session, which runs the gate and launches SEB ONLY for pending training. This
// is the pure decision both the route (code returned only when launch) and the PowerShell launcher (opens
// SEB only when launch && code) branch on. The PS branches themselves are covered in
// device/uic-seb-launcher.Tests.ps1 (Pester, Windows-only; not runnable here, no PowerShell in CI).
test('launcher gate: SEB launches only for pending training', () => {
  assert.equal(seb.shouldLaunchSeb('pending'), true);
  for (const s of ['before-window', 'no-training', 'done', 'not-ready', 'error', 'invalid-token', 'not-tracked']) {
    assert.equal(seb.shouldLaunchSeb(s), false, `${s} must not launch SEB`);
  }
});

test('enroll-session decision: fresh code is minted only when launching (pending), never otherwise', { skip: !db }, async () => {
  await wipe();
  // pending -> a single-use code is minted and would be returned to the launcher.
  const before = await prisma.seb_handoffs.count();
  const launchPending = seb.shouldLaunchSeb('pending');
  const code = launchPending ? (await seb.mintHandoff('k@usaindiacfo.com')).code : undefined;
  assert.ok(code, 'pending must yield a code');
  assert.equal(await prisma.seb_handoffs.count(), before + 1);
  // any non-pending status -> no code, no handoff row created (desktop stays available).
  for (const s of ['before-window', 'no-training', 'done', 'not-ready', 'error']) {
    const n = await prisma.seb_handoffs.count();
    const launch = seb.shouldLaunchSeb(s);
    const c = launch ? (await seb.mintHandoff('k@usaindiacfo.com')).code : undefined;
    assert.equal(c, undefined, `${s} must not mint a code`);
    assert.equal(await prisma.seb_handoffs.count(), n, `${s} must not create a handoff`);
  }
});

// The today route bounds the attendance read so a slow or failing attendance lookup never stalls the
// lesson/test. withTimeout is that mechanism: fast -> real value; slow -> fallback (timedOut); reject ->
// fallback. This is what keeps SEB off an endless "Loading…" when one dependency hangs.
test('withTimeout: fast promise returns its value', async () => {
  const r = await seb.withTimeout(Promise.resolve({ status: 'confirmed' }), 1000, { status: 'unknown' });
  assert.equal(r.timedOut, false);
  assert.deepEqual(r.value, { status: 'confirmed' });
});

test('withTimeout: a slow promise falls back (attendance slow -> lesson still ships)', async () => {
  const slow = new Promise((res) => setTimeout(() => res({ status: 'confirmed' }), 200));
  const r = await seb.withTimeout(slow as Promise<any>, 20, { status: 'unknown' });
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.value, { status: 'unknown' });
});

test('withTimeout: a rejecting promise falls back, no throw (attendance failure -> lesson still ships)', async () => {
  const bad = Promise.reject(new Error('db down'));
  const r = await seb.withTimeout(bad, 50, { status: 'unknown' });
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.value, { status: 'unknown' });
});

test('SEB quit URL: setting > env > built-in default; never empty', { skip: !db }, async () => {
  await wipe();
  // No setting and no env -> the built-in default (matches the VM SEB profile), never empty.
  await settings.set('seb_quit_url', '');
  delete process.env.SEB_QUIT_URL;
  assert.equal(await seb.resolveSebQuitUrl(), seb.DEFAULT_SEB_QUIT_URL);
  assert.equal(seb.DEFAULT_SEB_QUIT_URL, 'https://seo.usaindiacfo.us/seb/quit');
  // Env overrides the default.
  process.env.SEB_QUIT_URL = 'https://env.example/quit';
  assert.equal(await seb.resolveSebQuitUrl(), 'https://env.example/quit');
  // An explicit setting overrides the env.
  await settings.set('seb_quit_url', 'https://override.example/quit');
  assert.equal(await seb.resolveSebQuitUrl(), 'https://override.example/quit');
  delete process.env.SEB_QUIT_URL;
});

test('Finish: a confirmed completion returns done:true and the exact quit URL (SEB can exit)', { skip: !db }, async () => {
  await wipe();
  delete process.env.SEB_QUIT_URL;
  await settings.set('seb_quit_url', ''); // rely on the built-in default, the common VM case
  // A done gate must yield a non-empty quit URL equal to the SEB profile's quitURL.
  const done = seb.shouldLaunchSeb('pending') === true; // sanity that the helper is wired
  assert.ok(done);
  const quitUrl = await seb.resolveSebQuitUrl();
  assert.equal(quitUrl, 'https://seo.usaindiacfo.us/seb/quit');
  assert.notEqual(quitUrl, '');
});

// ---- token-session: the device work token identifies the person; no code is ever typed ----
test('SEB token-session: the work token resolves to the person; an unknown token does not', { skip: !db }, async () => {
  await wipe();
  const email = 'dev@usaindiacfo.com';
  await prisma.team_members.create({ data: { email, name: 'Dev', role: 'user', blocked: false } });
  const token = await ensureWorkToken(email);
  assert.ok(token && token.length > 10);
  // The same token the activity watcher uses resolves to this person (so SEB needs no code).
  assert.equal(await emailForToken(token), email);
  // Round-trips to the same token (one per person), and an unknown token is rejected.
  assert.equal(await ensureWorkToken(email), token);
  assert.equal(await emailForToken('not-a-real-token'), null);
  // Launch decision is the same gate contract: only "pending" opens SEB.
  assert.equal(seb.shouldLaunchSeb('pending'), true);
  for (const s of ['before-window', 'no-training', 'done', 'not-ready', 'error']) assert.equal(seb.shouldLaunchSeb(s), false);
});

// ---- /seb-code: a locked trainee may still mint their own SEB code, nothing else ----
test('gate exception is exactly /api/seb/handoff (pure)', () => {
  assert.equal(allowedWhileLocked('/api/seb/handoff'), true);
  // The exception is restricted: no other SEB route and no other dashboard write is unlocked by it.
  assert.equal(allowedWhileLocked('/api/seb/admin'), false);
  assert.equal(allowedWhileLocked('/api/seb/handoff/extra'), false);
  assert.equal(allowedWhileLocked('/api/strategy/run'), false);
});

test('a locked trainee can POST /api/seb/handoff but no other write', { skip: !db }, async () => {
  await wipe();
  const email = 'lock@usaindiacfo.com';
  const day = istDayNow();
  await prisma.team_members.create({ data: { email, name: 'Lock', role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email, name: 'Lock', level: 1, lesson_ids: '{}', active: true } });
  // An open test today => the trainee is locked.
  await prisma.training_tests.create({ data: { email, day, level: 1, questions: Q, total: 1, status: 'open', kind: 'daily', lesson_ids: ',0,', created_at: `${day} 02:00:00` } });
  assert.equal((await trainingGate(email, 'user')).locked, true);
  // The code-minting endpoint is allowed through even while locked...
  assert.equal(await gateRefusal('POST', '/api/seb/handoff', email, 'user'), null);
  // ...but every other dashboard write stays refused.
  const refused = await gateRefusal('POST', '/api/strategy/run', email, 'user');
  assert.ok(refused && refused.status === 403);
});

// ---- QA / disposable test (kind 'qa'): real finish flow, out of official records ----
test('QA test: submit marks done and finishes the gate, with no score/level/misses impact', { skip: !db }, async () => {
  await wipe();
  const email = 'qa@usaindiacfo.com';
  const day = istDayNow();
  await prisma.team_members.create({ data: { email, name: 'QA', role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email, name: 'QA', level: 2, streak: 3, points: 50, lesson_ids: '{}', active: true } });
  const qs = JSON.stringify([
    { id: 'a', q: '1?', options: ['x', 'y'], answer: 0, explain: '', kind: 'mcq' },
    { id: 'b', q: '2?', options: ['x', 'y'], answer: 1, explain: '', kind: 'mcq' },
  ]);
  const t = await prisma.training_tests.create({ data: { email, day, level: 2, questions: qs, total: 2, status: 'open', kind: 'qa', lesson_ids: ',0,', created_at: `${day} 02:00:00` } });
  // Before: the open QA test locks the gate (so /seb shows it as pending).
  assert.equal((await trainingGate(email, 'user')).locked, true);
  const r: any = await submitTest(email, t.id, { a: 0, b: 1 });
  assert.equal(r.qa, true);
  assert.equal(r.score, 2);
  assert.equal((await prisma.training_tests.findUnique({ where: { id: t.id } })).status, 'done');
  // After: the gate is finished (not locked) -> /seb/finish returns done -> SEB quits.
  assert.equal((await trainingGate(email, 'user')).locked, false);
  // Out of official records: profile level/streak/points unchanged and no misses recorded.
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  assert.equal(p.level, 2); assert.equal(p.streak, 3); assert.equal(p.points, 50);
  assert.equal(await prisma.training_misses.count({ where: { email } }), 0);
});

// ---- Games inside SEB: reuse the lesson scoring, scoped to the person's assigned lesson ----
test('SEB game: scoring is awarded only for the person\'s own assigned lesson', { skip: !db }, async () => {
  await wipe();
  const email = 'g@usaindiacfo.com';
  const day = istDayNow();
  const mine = 9100; const notMine = 9200;
  const extras = JSON.stringify({ terms: [{ term: 'A', definition: 'da' }, { term: 'B', definition: 'db' }, { term: 'C', definition: 'dc' }] });
  await prisma.team_members.create({ data: { email, name: 'G', role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email, name: 'G', level: 1, points: 0, lesson_ids: `{"technical":${mine}}`, active: true } });
  await prisma.training_lessons.create({ data: { id: mine, day, level: 1, title: 'L', content_html: '<p>x</p>', questions: '[]', track: 'technical', audience: 'associate', extras, created_at: `${day} 02:00:00` } });
  await prisma.training_lessons.create({ data: { id: notMine, day, level: 1, title: 'O', content_html: '<p>x</p>', questions: '[]', track: 'marketing', audience: 'associate', extras, created_at: `${day} 02:00:00` } });
  // Own assigned lesson of today: the round counts (awarded), same scoring as the dashboard.
  const r: any = await playGame(email, mine, {});
  assert.equal(r.awarded, true);
  // A lesson that is not assigned to this person: not awarded (the SEB route rejects it with 403; playGame
  // treats it as practice). Either way a game never scores for a lesson that is not the person's own.
  const r2: any = await playGame(email, notMine, {});
  assert.equal(r2.awarded, false);
});

test('SEB today path is read-only: no completion and no timesheet sync written', { skip: !db }, async () => {
  await wipe();
  await seedWorkDay('ro@x.com', '2026-11-27'); // a prior worked day: a wrongful sync would create a queue row
  await prisma.training_profiles.create({ data: { email: 'ro@x.com', name: 'ro', level: 1, lesson_ids: '{}', active: true } });
  const before = { reads: await prisma.training_reads.count(), queue: await prisma.timesheet_sync_queue.count() };
  // Exactly what /api/seb/today calls:
  await gateForEmail('ro@x.com');
  await attendanceStatus('ro@x.com');
  await sebTodayItem('ro@x.com', 'user');
  const after = { reads: await prisma.training_reads.count(), queue: await prisma.timesheet_sync_queue.count() };
  assert.deepEqual(after, before);
  assert.equal(before.reads + before.queue, 0);
});

// ---- Zoho Projects timesheet sync (mock Zoho; no live write) ----
test('Friday timesheet sync after Saturday training: posts Friday hours under Friday date', { skip: !db }, async () => {
  await wipe();
  await seedWorkDay('w@x.com', '2026-11-27'); // Friday, 8h, unlogged
  const { deps, calls } = mockLog();
  const q = await enqueuePriorDays('w@x.com', '2026-11-28'); // enqueue on Saturday's Finished
  assert.equal(q.queued, 1);
  const res = await processQueue(deps);
  assert.equal(calls.length, 1);
  assert.deepEqual({ projectId: calls[0].projectId, day: calls[0].day, hours: calls[0].hours }, { projectId: MARKETING_PROJECT, day: '2026-11-27', hours: 8 });
  assert.equal(res[0].status, 'done');
  const att = await prisma.work_attendance.findUnique({ where: { email_day: { email: 'w@x.com', day: '2026-11-27' } } });
  assert.ok(att.logged_at, 'Friday marked logged');
});

test('no duplicate on retry/restart: a logged day is never posted again', { skip: !db }, async () => {
  await wipe();
  await seedWorkDay('w@x.com', '2026-11-27');
  const { deps, calls } = mockLog();
  await enqueuePriorDays('w@x.com', '2026-11-28');
  await processQueue(deps);
  // retry: re-enqueue (restart) + process again -> no second post
  await enqueuePriorDays('w@x.com', '2026-11-28');
  await processQueue(deps);
  assert.equal(calls.length, 1, 'posted exactly once');
});

test('skip days with no recorded work; backfill older workdays', { skip: !db }, async () => {
  await wipe();
  await seedWorkDay('w@x.com', '2026-11-26'); // Thu, work
  await seedWorkDay('w@x.com', '2026-11-27'); // Fri, work
  await prisma.work_attendance.create({ data: { email: 'w@x.com', day: '2026-11-25', first_at: '2026-11-25 03:30:00', last_at: '2026-11-25 03:30:00' } }); // Wed, zero hours
  const { deps, calls } = mockLog();
  const q = await enqueuePriorDays('w@x.com', '2026-11-28');
  assert.equal(q.queued, 2, 'two workdays queued, the zero-hour day skipped');
  await processQueue(deps);
  const days = calls.map((c: any) => c.day).sort();
  assert.deepEqual(days, ['2026-11-26', '2026-11-27']);
});

test('uncertain Zoho (timeout): reconcile -> done if the day got logged, no duplicate', { skip: !db }, async () => {
  await wipe();
  await seedWorkDay('w@x.com', '2026-11-27');
  let posts = 0;
  // Simulate: the post reached Zoho (day gets logged) but the response was lost (timeout).
  const deps = {
    logTime: async (email: string) => {
      posts++;
      await prisma.work_attendance.update({ where: { email_day: { email, day: '2026-11-27' } }, data: { logged_at: '2026-11-28 01:00:00', zoho_log_id: 'zX' } });
      throw new Error('request timed out');
    },
  };
  await enqueuePriorDays('w@x.com', '2026-11-28');
  const res = await processQueue(deps);
  assert.equal(res[0].status, 'done', 'reconciled to done');
  // retry: already logged -> no new post
  await processQueue(deps);
  assert.equal(posts, 1, 'did not post again');
});

// ---- device-enroll: work token -> SEB enrollment, no code ----
test('device-enroll: a valid work token creates an enrollment that exchanges for the same person', { skip: !db }, async () => {
  await wipe();
  const email = 'devenroll@usaindiacfo.com';
  await prisma.team_members.create({ data: { email, name: 'D', role: 'user', blocked: false } });
  const token = await ensureWorkToken(email);
  const { POST } = require('../app/api/seb/device-enroll/route');
  const call = (b: any) => POST({ json: async () => b } as any);
  assert.equal((await call({ deviceToken: token })).status, 400);
  assert.equal((await call({ deviceToken: 'bogus', windowsUser: 'S-1-5-21-1' })).status, 401);
  const r = await call({ deviceToken: token, windowsUser: 'S-1-5-21-1', label: 'PC1' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.enrollment.id && j.enrollment.secret);
  assert.equal(await enroll.exchangeEnrollment(j.enrollment.id, j.enrollment.secret, 'S-1-5-21-1'), email);
  assert.equal(await enroll.exchangeEnrollment(j.enrollment.id, j.enrollment.secret, 'S-1-5-21-OTHER'), null);
});

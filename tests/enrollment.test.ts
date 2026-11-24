import test from 'node:test';
import assert from 'node:assert/strict';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.NEXTAUTH_SECRET ||= 'test-secret';
/* eslint-disable @typescript-eslint/no-require-imports */
const prisma = require('../lib/prisma').default;
const enroll = require('../lib/trainingEnroll') as typeof import('../lib/trainingEnroll');
const settings = require('../lib/settings') as typeof import('../lib/settings');
const { anyActiveTraineeMissingToday } = require('../lib/associateTraining') as typeof import('../lib/associateTraining');

async function wipe() {
  for (const t of ['activity_log', 'training_profiles', 'team_members', 'settings']) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${t}`).catch(() => {});
  }
}

test('isCompanyEmail / clampLevel (pure)', () => {
  assert.equal(enroll.isCompanyEmail('a@usaindiacfo.com'), true);
  assert.equal(enroll.isCompanyEmail('a@gmail.com'), false);
  assert.equal(enroll.isCompanyEmail('not-an-email'), false);
  assert.equal(enroll.clampLevel(0), 1);
  assert.equal(enroll.clampLevel(9), 5);
  assert.equal(enroll.clampLevel('3'), 3);
  assert.equal(enroll.clampLevel('x'), 1);
});

test('listEnrolled excludes admin, shows profile state for non-admins', { skip: !db }, async () => {
  await wipe();
  await prisma.team_members.create({ data: { email: 'boss@usaindiacfo.com', role: 'admin', blocked: false } });
  await prisma.team_members.create({ data: { email: 'mgr@usaindiacfo.com', name: 'Mgr', role: 'manager', blocked: false } });
  await prisma.team_members.create({ data: { email: 'usr@usaindiacfo.com', role: 'user', blocked: true } });
  await prisma.training_profiles.create({ data: { email: 'mgr@usaindiacfo.com', name: 'Mgr', level: 3, active: true } });
  const rows = await enroll.listEnrolled();
  assert.equal(rows.find((r) => r.email === 'boss@usaindiacfo.com'), undefined); // admin never listed
  const mgr = rows.find((r) => r.email === 'mgr@usaindiacfo.com')!;
  assert.equal(mgr.enrolled, true); assert.equal(mgr.level, 3); assert.equal(mgr.active, true);
  const usr = rows.find((r) => r.email === 'usr@usaindiacfo.com')!;
  assert.equal(usr.enrolled, false); assert.equal(usr.level, null); assert.equal(usr.blocked, true);
});

test('ensureProfile creates once and never duplicates', { skip: !db }, async () => {
  await wipe();
  const a = await enroll.ensureProfile('k@usaindiacfo.com', { level: 2, actor: 't' });
  assert.equal(a.created, true); assert.equal(a.profile.level, 2);
  const b = await enroll.ensureProfile('k@usaindiacfo.com', { level: 5, actor: 't' });
  assert.equal(b.created, false); assert.equal(b.profile.level, 2); // unchanged, not duplicated
  assert.equal(await prisma.training_profiles.count({ where: { email: 'k@usaindiacfo.com' } }), 1);
});

test('setActive / setLevel / unblock', { skip: !db }, async () => {
  await wipe();
  await prisma.team_members.create({ data: { email: 'u@usaindiacfo.com', role: 'user', blocked: true } });
  await enroll.ensureProfile('u@usaindiacfo.com', { level: 1, actor: 't' });
  await enroll.setActive('u@usaindiacfo.com', false, 't');
  assert.equal((await prisma.training_profiles.findUnique({ where: { email: 'u@usaindiacfo.com' } })).active, false);
  await enroll.setLevel('u@usaindiacfo.com', 9, 't'); // clamps to 5
  assert.equal((await prisma.training_profiles.findUnique({ where: { email: 'u@usaindiacfo.com' } })).level, 5);
  await enroll.unblock('u@usaindiacfo.com', 't');
  assert.equal((await prisma.team_members.findUnique({ where: { email: 'u@usaindiacfo.com' } })).blocked, false);
});

test('removePerson deletes the team member, profile, token and SEB rows', { skip: !db }, async () => {
  for (const t of ['team_members', 'training_profiles', 'work_tokens', 'seb_enrollments']) await prisma.$executeRawUnsafe(`DELETE FROM ${t}`).catch(() => {});
  const who = 'rahul.sharm@usaindiacfo.com'; // the typo entry
  await prisma.team_members.create({ data: { email: who, role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email: who, level: 1, active: true } });
  await prisma.work_tokens.create({ data: { email: who, token: 'tkn-typo-123' } }).catch(() => {});
  await prisma.seb_enrollments.create({ data: { id: 'e-typo', email: who, windows_user: 'S-1', secret_hash: 'h' } }).catch(() => {});
  const r = await enroll.removePerson(who, 'admin');
  assert.ok(r.removed.length >= 2);
  assert.equal(await prisma.team_members.count({ where: { email: who } }), 0);
  assert.equal(await prisma.training_profiles.count({ where: { email: who } }), 0);
  assert.equal(await prisma.work_tokens.count({ where: { email: who } }), 0);
  assert.equal(await prisma.seb_enrollments.count({ where: { email: who } }), 0);
});

test('catch-up: a newly enrolled active trainee is detected as missing today, then not after content exists', { skip: !db }, async () => {
  for (const t of ['training_lessons', 'training_tests', 'training_profiles', 'team_members']) await prisma.$executeRawUnsafe(`DELETE FROM ${t}`).catch(() => {});
  const day = '2099-01-15';
  // No trainees at all -> nobody missing.
  assert.equal(await anyActiveTraineeMissingToday(day), false);
  // An active trainee with no content for the day -> missing (the scheduler tick will generate it).
  await prisma.team_members.create({ data: { email: 'new@usaindiacfo.com', role: 'user', blocked: false } });
  await prisma.training_profiles.create({ data: { email: 'new@usaindiacfo.com', level: 1, active: true, lesson_ids: '{}' } });
  assert.equal(await anyActiveTraineeMissingToday(day), true);
  // Give them a test for the day -> no longer missing.
  await prisma.training_tests.create({ data: { email: 'new@usaindiacfo.com', day, level: 1, questions: '[]', total: 1, status: 'open' } });
  assert.equal(await anyActiveTraineeMissingToday(day), false);
  // A paused profile is not counted.
  await prisma.training_profiles.update({ where: { email: 'new@usaindiacfo.com' }, data: { active: false } });
  await prisma.training_tests.deleteMany({ where: { email: 'new@usaindiacfo.com' } });
  assert.equal(await anyActiveTraineeMissingToday(day), false);
});

test('autoEnrollOnLogin: off by default, on only for qualifying non-admins', { skip: !db }, async () => {
  await wipe();
  // Off by default -> nothing created.
  await enroll.autoEnrollOnLogin('a@usaindiacfo.com', 'A', 'user');
  assert.equal(await prisma.training_profiles.count(), 0);
  // Turn it on, limited to analyst.
  await settings.set('auto_enroll_on_login', 'on');
  await settings.set('auto_enroll_roles', 'analyst');
  await enroll.autoEnrollOnLogin('u@usaindiacfo.com', 'U', 'user'); // role not in list -> skip
  assert.equal(await prisma.training_profiles.count(), 0);
  await enroll.autoEnrollOnLogin('an@usaindiacfo.com', 'An', 'analyst'); // qualifies
  assert.equal((await prisma.training_profiles.findUnique({ where: { email: 'an@usaindiacfo.com' } }))?.level, 1);
  // Admin and non-company email never auto-enroll even when on.
  await settings.set('auto_enroll_roles', '');
  await enroll.autoEnrollOnLogin('boss@usaindiacfo.com', 'B', 'admin');
  await enroll.autoEnrollOnLogin('x@gmail.com', 'X', 'user');
  assert.equal(await prisma.training_profiles.findUnique({ where: { email: 'boss@usaindiacfo.com' } }), null);
  assert.equal(await prisma.training_profiles.findUnique({ where: { email: 'x@gmail.com' } }), null);
});

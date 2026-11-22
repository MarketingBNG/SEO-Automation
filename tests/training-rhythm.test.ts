import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestDayFor, isLessonDayFor, testWeekdaysFor, isGrandTestDay, type Schedule } from '../lib/trainingSchedule';

// Week 1 = 2026-11-23 Mon .. 11-29 Sun. Week 2 = 11-30 Mon .. 12-06 Sun.
const s: Schedule = { on: true, patternStart: '2026-11-23', surpriseStart: '2026-11-30', grandStart: '2026-12-01' };
const SEC = 'secret';
const week = (monday: string) => Array.from({ length: 6 }, (_, i) => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }); // Mon..Sat
const emails = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];

test('week 1: tests on Wed + Sat (fixed), lessons on Mon/Tue/Thu/Fri', () => {
  assert.deepEqual(testWeekdaysFor('a@x.com', '2026-11-24', s, SEC), [3, 6]);
  assert.equal(isTestDayFor('a@x.com', '2026-11-25', s, SEC), true);  // Wed
  assert.equal(isTestDayFor('a@x.com', '2026-11-28', s, SEC), true);  // Sat
  assert.equal(isTestDayFor('a@x.com', '2026-11-23', s, SEC), false); // Mon
  assert.equal(isLessonDayFor('a@x.com', '2026-11-23', s, SEC), true);  // Mon lesson
  assert.equal(isLessonDayFor('a@x.com', '2026-11-25', s, SEC), false); // Wed no lesson (test)
});

test('Sunday: no lesson, no test', () => {
  assert.equal(isTestDayFor('a@x.com', '2026-11-29', s, SEC), false);
  assert.equal(isLessonDayFor('a@x.com', '2026-11-29', s, SEC), false);
});

test('exactly 2 test days every week, for every person', () => {
  for (const monday of ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']) {
    for (const email of emails) {
      const tests = week(monday).filter((d) => isTestDayFor(email, d, s, SEC));
      assert.equal(tests.length, 2, `${email} week ${monday} has ${tests.length} tests`);
    }
  }
});

test('a day is a lesson day OR a test day, never both; never neither on a working day', () => {
  for (const monday of ['2026-11-23', '2026-11-30', '2026-12-07']) {
    for (const email of emails) {
      for (const d of week(monday)) {
        const t = isTestDayFor(email, d, s, SEC);
        const l = isLessonDayFor(email, d, s, SEC);
        assert.ok(!(t && l), `${email} ${d} is both`);
        assert.ok(t || l, `${email} ${d} is neither (working day)`);
      }
    }
  }
});

test('week 2+ test days are 2 distinct working days, stable within the week', () => {
  const td = testWeekdaysFor('a@x.com', '2026-11-30', s, SEC);
  assert.equal(td.length, 2);
  assert.notEqual(td[0], td[1]);
  assert.ok(td.every((d) => d >= 1 && d <= 6));
  // same for every day of that week
  for (const d of week('2026-11-30')) assert.deepEqual(testWeekdaysFor('a@x.com', d, s, SEC), td);
});

test('week 2+ test days are not fixed Wed/Sat for everyone (at least one person differs)', () => {
  const differs = emails.some((e) => JSON.stringify(testWeekdaysFor(e, '2026-11-30', s, SEC)) !== JSON.stringify([3, 6]));
  assert.ok(differs, 'week 2 should not be Wed/Sat for all');
});

test('monthly grand test: last Tuesday of the month from grandStart; not before', () => {
  assert.equal(isGrandTestDay('2026-12-29', s), true);  // last Tuesday of Dec 2026
  assert.equal(isGrandTestDay('2026-12-22', s), false); // not the last Tuesday
  assert.equal(isGrandTestDay('2026-12-01', s), false); // first Tuesday
  assert.equal(isGrandTestDay('2026-11-24', s), false); // last Tuesday of Nov, before grandStart (this month)
});

test('schedule off: a lesson and a test every day (old behaviour)', () => {
  const off: Schedule = { on: false, patternStart: '', surpriseStart: '', grandStart: '' };
  assert.equal(isTestDayFor('a@x.com', '2026-11-25', off, SEC), true);
  assert.equal(isLessonDayFor('a@x.com', '2026-11-25', off, SEC), true);
  assert.equal(isGrandTestDay('2026-12-29', off), false);
});

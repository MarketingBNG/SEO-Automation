import test from 'node:test';
import assert from 'node:assert/strict';
import { isLessonDay, isTestDay, surpriseOn } from '../lib/trainingSchedule';

// 2026-11-23 Mon, 24 Tue, 25 Wed, 26 Thu, 27 Fri, 28 Sat, 29 Sun.
const s = { on: true, patternStart: '2026-11-23', surpriseStart: '2026-11-30' };

test('weekly pattern: Mon/Tue/Thu/Fri lessons, Wed/Sat tests, Sun off', () => {
  assert.equal(isLessonDay('2026-11-23', s), true); // Mon
  assert.equal(isLessonDay('2026-11-24', s), true); // Tue
  assert.equal(isLessonDay('2026-11-25', s), false); // Wed: no lesson
  assert.equal(isTestDay('2026-11-25', s), true); // Wed: test
  assert.equal(isLessonDay('2026-11-26', s), true); // Thu
  assert.equal(isLessonDay('2026-11-27', s), true); // Fri
  assert.equal(isLessonDay('2026-11-28', s), false); // Sat: no lesson
  assert.equal(isTestDay('2026-11-28', s), true); // Sat: test
  assert.equal(isLessonDay('2026-11-29', s), false); // Sun off
  assert.equal(isTestDay('2026-11-29', s), false); // Sun off
  assert.equal(isTestDay('2026-11-23', s), false); // Mon: no test
});

test('before the pattern starts: lessons only (no Sunday), no tests', () => {
  assert.equal(isLessonDay('2026-11-21', s), true); // Sat before start: lesson
  assert.equal(isTestDay('2026-11-21', s), false); // no test before start
  assert.equal(isLessonDay('2026-11-22', s), false); // Sun off
});

test('surprise tests begin on their start date', () => {
  assert.equal(surpriseOn('2026-11-25', s), false);
  assert.equal(surpriseOn('2026-11-29', s), false);
  assert.equal(surpriseOn('2026-11-30', s), true);
});

test('schedule off: a lesson and a test every day (old behaviour)', () => {
  const off = { on: false, patternStart: '', surpriseStart: '' };
  assert.equal(isLessonDay('2026-11-25', off), true);
  assert.equal(isTestDay('2026-11-25', off), true);
  assert.equal(surpriseOn('2026-11-25', off), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capTest, gradeByKeyPoints, MAX_TEST_QUESTIONS, MAX_LEVEL } from '../lib/associateTraining';
import { LEVELS, bandOf, levelLabel, TECH_CURRICULUM, topicFor } from '../lib/trainingContent';

const mcq = (topic: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${topic}-${i}`, q: 'q', options: ['a', 'b', 'c', 'd'], answer: 0, explain: '', track: 'technical' as const, topic }));
const wr = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w-${i}`, q: 'w', options: [], answer: -1, explain: '', kind: 'written' as const, points: ['x'] }));

test('a daily test never asks more than MAX_TEST_QUESTIONS, spread over every lesson', () => {
  const fresh = [...mcq('A', 17), ...mcq('B', 17), ...mcq('C', 17), ...wr(4)];
  const out = capTest(fresh, mcq('R', 3).map((q) => ({ ...q, repeat: true })));
  assert.equal(out.length, MAX_TEST_QUESTIONS);
  assert.equal(out.filter((q) => q.kind === 'written').length, 2);
  for (const t of ['A', 'B', 'C']) assert.ok(out.some((q) => q.topic === t), `lesson ${t} is asked about`);
  assert.equal(out.filter((q) => q.repeat).length, 3);
});

test('a small day is kept whole', () => {
  const fresh = [...mcq('A', 5), ...wr(1)];
  assert.equal(capTest(fresh, []).length, 6);
});

test('key-point grading without AI', () => {
  const q: any = { points: ['FBAR is filed with FinCEN', 'threshold is aggregate balance', 'due April with automatic extension'] };
  assert.equal(gradeByKeyPoints(q, 'The FBAR is filed with FinCEN when the aggregate balance passes the threshold, due in April with an automatic extension.').score, 1);
  assert.equal(gradeByKeyPoints(q, 'I do not know').score, 0);
});

test('twelve levels in four bands, everyone can reach Expert', () => {
  assert.equal(MAX_LEVEL, 12);
  assert.equal(Object.keys(LEVELS).length, 12);
  assert.equal(bandOf(1), 'Basic');
  assert.equal(bandOf(4), 'Intermediate');
  assert.equal(bandOf(9), 'Advanced');
  assert.equal(bandOf(12), 'Expert');
  assert.equal(levelLabel(5), 'Level 5 (Intermediate 2/3)');
  assert.ok(TECH_CURRICULUM.Basic.includes(topicFor('technical', '2026-11-26', 1)));
  assert.ok(TECH_CURRICULUM.Expert.includes(topicFor('technical', '2026-11-26', 11)));
});

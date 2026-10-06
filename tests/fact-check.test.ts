// The automatic fact-check loop: check, correct, re-check until two clean passes in a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims } from '../lib/strategy/core';

// lib/anthropic imports the database client, which needs a URL (never connected in these tests).
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = async () => (await import('../lib/anthropic')).verifyAndCorrect;

const draft = { title: 'FBAR guide', meta: 'meta', content: '<p>The FBAR filing deadline is April 30.</p>', facts: [] };
const mustCheckOf = (html: string) => extractClaims(html).map((c) => c.sentence);

test('a wrong figure is corrected, then two clean checks pass', async () => {
  let checks = 0;
  const check = async (d: any) => {
    checks++;
    const wrong = d.content.includes('April 30');
    return { checks: [{ claim: wrong ? 'The FBAR filing deadline is April 30.' : 'The FBAR filing deadline is April 15.', verdict: wrong ? 'incorrect' : 'correct', correction: 'April 15', source_url: 'https://www.fincen.gov/fbar' }] };
  };
  const correct = async (d: any) => ({ ...d, content: d.content.replace('April 30', 'April 15') });
  const verifyAndCorrect = await load();
  const r = await verifyAndCorrect(draft, { check, correct, mustCheckOf, maxRounds: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 3); // wrong -> corrected -> clean -> clean
  assert.equal(checks, 3);
  assert.ok(r.draft.content.includes('April 15'));
});

test('one clean pass is not enough; a skipped figure sentence is not clean', async () => {
  let n = 0;
  // Round 1 clean, round 2 skips the sentence, rounds 3 and 4 clean.
  const check = async () => {
    n++;
    return { checks: n === 2 ? [] : [{ claim: 'The FBAR filing deadline is April 30.', verdict: 'correct' }] };
  };
  const verifyAndCorrect = await load();
  const r = await verifyAndCorrect(draft, { check, correct: async (d: any) => d, mustCheckOf, maxRounds: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.rounds, 4);
});

test('a claim that can never be verified is held after the round limit', async () => {
  const check = async () => ({ checks: [{ claim: 'The FBAR filing deadline is April 30.', verdict: 'unverifiable' }] });
  let fixes = 0;
  const verifyAndCorrect = await load();
  const r = await verifyAndCorrect(draft, { check, correct: async (d: any) => (fixes++, d), mustCheckOf, maxRounds: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 5);
  assert.equal(fixes, 5);
});

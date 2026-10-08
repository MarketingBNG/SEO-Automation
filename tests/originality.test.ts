process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, failed, plainText } from '../lib/originality';

const source = 'An ITIN is a tax processing number issued by the Internal Revenue Service for people who must file a US return but cannot get a Social Security Number, including many non-resident Indians with rental income in the United States.';

test('copied passages fail, original writing passes', () => {
  const copied = `<p>Here is the basic idea.</p><p>${source}</p><p>Our team can help.</p>`;
  const m = compare(plainText(copied), source, 'https://example.com/itin');
  assert.ok(m.longestRun >= 25, `run ${m.longestRun}`);
  assert.ok(failed(m));
  const own = '<p>Indian residents who earn US rent usually need an ITIN to file. The IRS issues it after Form W-7 is approved, and a Certified Acceptance Agent can verify the passport locally.</p>';
  const o = compare(plainText(own), source, 'https://example.com/itin');
  assert.equal(failed(o), false);
  assert.ok(o.longestRun < 25);
});

test('short common phrases do not count as copying', () => {
  const m = compare('You must file a US return by the deadline.', source, 's');
  assert.equal(failed(m), false);
});

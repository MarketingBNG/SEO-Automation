// Plain words on when a calendar blog goes live, and the cover's alt text in schema and Word.
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishPlan } from '../lib/strategy/core';
import { expertSchema } from '../lib/byline';
import { coverAlt } from '../lib/cover';

const now = new Date('2026-10-08T10:00:00Z');
const base = { publish_at: '2026-10-10 04:30:00', title: 'How to open a US LLC from India', main_keyword: 'open us llc from india' };

test('a planned blog says when it is written, reviewed and published', () => {
  const p = publishPlan({ ...base, status: 'planned' }, now);
  assert.match(p.headline, /^Scheduled for 10 Oct 2026/);
  assert.match(p.detail, /72 hours/);
  assert.match(p.detail, /48-hour review from 8 Oct 2026/);
  assert.equal(p.when, '2026-10-10T04:30:00.000Z');
});

test('a blog in review explains both outcomes: approve now, or it goes out on its own', () => {
  const p = publishPlan({ ...base, status: 'in_review', review_started: '2026-10-07 04:30:00' }, now);
  assert.equal(p.headline, 'Waiting for approval');
  assert.match(p.detail, /Approve it and it publishes at 10 Oct 2026/);
  assert.match(p.detail, /publishes on its own at that time/);
  // A late review window pushes the automatic publish past the slot.
  const late = publishPlan({ ...base, status: 'in_review', review_started: '2026-10-09 04:30:00' }, now);
  assert.match(late.detail, /on its own at 11 Oct 2026/);
  assert.equal(late.when, '2026-10-11T04:30:00.000Z');
});

test('an approved blog publishes at its slot, or at the next check once the slot has passed', () => {
  const p = publishPlan({ ...base, status: 'in_review', review_started: '2026-10-07 04:30:00', reviewed_at: '2026-10-08 09:00:00', reviewed_by: 'Priya' }, now);
  assert.equal(p.headline, 'Approved by Priya');
  assert.match(p.detail, /Publishes automatically at 10 Oct 2026/);
  const passed = publishPlan({ ...base, publish_at: '2026-10-08 04:30:00', status: 'in_review', review_started: '2026-10-06 04:30:00', reviewed_at: '2026-10-08 09:00:00', reviewed_by: 'Priya' }, now);
  assert.match(passed.detail, /next check, within about 15 minutes/);
});

test('tax blogs wait for a CA/CPA; held and rewritten blogs say so', () => {
  const tax = publishPlan({ ...base, title: 'NRI tax filing deadline 2026', main_keyword: 'nri tax filing', status: 'in_review', review_started: '2026-10-07 04:30:00' }, now, { requireExpert: true });
  assert.equal(tax.headline, 'Waiting for a CA/CPA to approve it');
  assert.equal(tax.when, null);
  const held = publishPlan({ ...base, status: 'held', hold_reasons: JSON.stringify(['Two claims could not be verified.']) }, now);
  assert.equal(held.headline, 'Held, not publishing');
  assert.equal(held.detail, 'Two claims could not be verified.');
  assert.equal(publishPlan({ ...base, status: 'rejected' }, now).headline, 'Rejected, rewrite queued');
  assert.equal(publishPlan({ ...base, status: 'published', wp_post_url: 'https://usaindiacfo.com/x/', updated_at: '2026-10-10 04:31:00' }, now).detail, 'Live at https://usaindiacfo.com/x/');
});

test('the cover goes into the article schema, and its alt text falls back to the title', () => {
  const s = expertSchema({ title: 'T', author: 'Harsh Jain', image: 'https://usaindiacfo.com/wp-content/uploads/cover.png' }, now)!;
  const data = JSON.parse(s.replace(/<\/?script[^>]*>/g, ''));
  assert.equal(data.mainEntity.image, 'https://usaindiacfo.com/wp-content/uploads/cover.png');
  assert.equal(coverAlt({ cover_alt: ' A founder signing LLC papers ', title: 'T' }), 'A founder signing LLC papers');
  assert.equal(coverAlt({ cover_alt: null, title: 'How to open a US LLC from India' }), 'How to open a US LLC from India');
  assert.equal(coverAlt({}), 'Blog cover image');
});

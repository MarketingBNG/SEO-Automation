// Unit tests for the strategy rules. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priorityScore, validatePlan, approvalBlockers, crawlIsFresh, scheduleAction, factsGate, writingRuleIssues, faqSchema, nextPeriod,
} from '../lib/strategy/core';

const m = (value: number | null) => ({ value, source: 'test', range: 'test' });

// A plan that passes every rule; tests break one rule at a time.
function goodPlan(): any {
  const blog = (i: number, tags: string[], intent = 'informational') => ({ title: `Blog ${i}`, mainKeyword: `kw ${i}`, tags, focusService: 'US tax', intent });
  const cal = [blog(1, ['SEO']), blog(2, ['AEO']), blog(3, ['GEO']), blog(4, ['SEO', 'AEO']), blog(5, ['SEO'])];
  const intents = ['informational', 'informational', 'informational', 'informational', 'informational', 'commercial', 'commercial', 'commercial', 'comparison', 'comparison'];
  return {
    period: 'November 2026',
    lastMonthTrend: { SEO: 5, AEO: 3, GEO: 10 },
    summary: { focus: 'x', declineNotes: {} },
    included: [{ item: 'Blogs', tags: ['SEO'] }],
    keywords: intents.map((intent, i) => ({ keyword: `kw ${i}`, intent, tags: ['SEO'], focusService: 'US tax' })),
    blogPlan: { calendar: cal },
    aeoGeo: { items: [{ target: 'q', tags: ['AEO', 'GEO'] }] },
    backlinks: [{ targetSite: 'a.com', method: 'Unlinked brand mention', ourPage: '/', tags: ['SEO', 'GEO'] }],
    technical: { fixes: [{ issue: '404', tags: ['SEO'] }], refreshes: [] },
    targets: [
      { channel: 'SEO', kpi: 'Clicks', lastMonth: m(100), target: 120 },
      { channel: 'AEO', kpi: 'Featured snippets', lastMonth: m(2), target: 4 },
      { channel: 'GEO', kpi: 'AI chat mentions', lastMonth: m(null), target: 3 },
      { channel: 'Signal', kpi: 'Organic leads', lastMonth: m(10), target: null },
    ],
  };
}

test('priority score follows the formula', () => {
  // BV 5 -> 15, volume 1200 -> 4*2=8, difficulty 20 -> 4*2=8, position 14 -> +5
  assert.equal(priorityScore({ businessValue: 5, volumeUs: 1000, volumeIndia: 200, difficulty: 20, currentPosition: 14 }), 36);
  assert.equal(priorityScore({ businessValue: 2, volumeUs: 50, volumeIndia: null, difficulty: 80, currentPosition: 5 }), 8);
});

test('a valid plan passes', () => {
  const v = validatePlan(goodPlan(), { focusServices: ['US tax'] });
  assert.deepEqual(v.errors, []);
});

test('untagged items are rejected', () => {
  const p = goodPlan();
  p.backlinks[0].tags = [];
  p.keywords[0].tags = undefined;
  const v = validatePlan(p);
  assert.ok(v.errors.some((e) => e.includes('a.com') && e.includes('no SEO, AEO or GEO tag')));
});

test('flat or lower targets are blocked', () => {
  const p = goodPlan();
  p.targets[0].target = 100; // equal to last month
  p.targets[1].target = 1; // lower
  const v = validatePlan(p);
  assert.ok(v.errors.some((e) => e.includes('SEO Clicks target 100 is not higher')));
  assert.ok(v.errors.some((e) => e.includes('AEO Featured snippets target 1 is not higher')));
});

test('organic leads cannot have a target', () => {
  const p = goodPlan();
  p.targets[3].target = 20;
  assert.ok(validatePlan(p).errors.some((e) => e.includes('signal only')));
});

test('a falling channel needs 40% of blogs and tasks plus an explanation', () => {
  const p = goodPlan();
  p.lastMonthTrend.GEO = -12;
  const v = validatePlan(p);
  assert.deepEqual(v.decliningChannels, ['GEO']);
  assert.ok(v.errors.some((e) => e.includes('40% of blogs must be tagged GEO')));
  assert.ok(v.errors.some((e) => e.includes('explain why GEO fell')));
});

test('main keywords cannot repeat across months', () => {
  const v = validatePlan(goodPlan(), { usedKeywords: new Set(['kw 2']) });
  assert.ok(v.errors.some((e) => e.includes('already used in an earlier month')));
});

test('unsafe backlink methods are blocked', () => {
  const p = goodPlan();
  p.backlinks[0].method = 'Paid guest post';
  assert.ok(validatePlan(p).errors.some((e) => e.includes('not an approved safe method')));
});

test('approve is blocked without a Screaming Frog crawl from the last 7 days', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  assert.equal(crawlIsFresh('2026-10-29 09:00:00', now), true);
  assert.equal(crawlIsFresh('2026-10-20 09:00:00', now), false);
  assert.ok(approvalBlockers(goodPlan(), { errors: [], warnings: [], decliningChannels: [] }, null, now)[0].includes('Screaming Frog'));
  assert.ok(approvalBlockers(goodPlan(), { errors: [], warnings: [], decliningChannels: [] }, { created_at: '2026-10-10 09:00:00' }, now).length === 1);
  assert.deepEqual(approvalBlockers(goodPlan(), { errors: [], warnings: [], decliningChannels: [] }, { created_at: '2026-10-31 09:00:00' }, now), []);
  assert.ok(approvalBlockers(goodPlan(), { errors: ['x'], warnings: [], decliningChannels: [] }, { created_at: '2026-10-31 09:00:00' }, now)[0].includes('validation'));
});

test('24-hour review window: opens 24h before, publishes at the slot', () => {
  const row = { status: 'planned', publish_at: '2026-11-03 04:30:00' };
  assert.equal(scheduleAction(row, new Date('2026-11-01T04:30:00Z')), 'wait');
  assert.equal(scheduleAction(row, new Date('2026-11-02T04:35:00Z')), 'open_review');
  // Nobody reviewed: at the slot the unreviewed blog is published (auto-approved).
  assert.equal(scheduleAction({ ...row, status: 'in_review' }, new Date('2026-11-03T04:30:00Z')), 'publish');
  // A once-a-day cron firing 40 minutes early still publishes today's slot.
  assert.equal(scheduleAction({ ...row, status: 'in_review' }, new Date('2026-11-03T03:50:00Z')), 'publish');
  // Held blogs are retried every run (they publish once the fact is added).
  assert.equal(scheduleAction({ ...row, status: 'held' }, new Date('2026-11-04T04:30:00Z')), 'publish');
  assert.equal(scheduleAction({ ...row, status: 'published' }, new Date('2026-11-04T04:30:00Z')), 'wait');
});

test('Facts Register gate holds unverified figures and releases verified ones', () => {
  const html = '<p>The TDS rate on rent is 10% under Section 194-I.</p><p>FBAR is due April 15 each year.</p><p>We help founders.</p>';
  const held = factsGate(html, []);
  assert.equal(held.length, 2);
  assert.ok(held[0].sentence.includes('TDS rate on rent is 10%'));
  assert.deepEqual(factsGate(html, [{ value: '10%' }, { value: 'April 15' }]), []);
  assert.equal(factsGate(html, [{ value: '10%' }]).length, 1);
});

test('writing rules', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const good = `<h2>What is X?</h2><p>${words(45)}</p><p><a href="/a">a</a><a href="/b">b</a><a href="https://usaindiacfo.com/c">c</a><a href="https://www.irs.gov/x">irs</a></p><h2>Frequently Asked Questions</h2><h3>Q?</h3><p>${words(50)}</p>`;
  assert.deepEqual(writingRuleIssues({ title: 'Short title', meta: 'Short meta', html: good, surferScore: 80, siteHost: 'usaindiacfo.com' }), []);
  const bad = writingRuleIssues({ title: 'x'.repeat(61), meta: 'y'.repeat(170), html: '<h2>Why?</h2><p>too short</p>', surferScore: 60, siteHost: 'usaindiacfo.com' });
  assert.equal(bad.length, 7);
  assert.ok(faqSchema(good)!.includes('"FAQPage"'));
});

test('next period', () => {
  assert.equal(nextPeriod(new Date('2026-10-01T03:30:00Z')), 'November 2026');
  assert.equal(nextPeriod(new Date('2026-12-01T03:30:00Z')), 'January 2027');
});

test('a flagged sentence never spans paragraphs', () => {
  const held = factsGate('<p>The FBAR is due April 15.</p><p>Other text here</p><h2>FAQ</h2>', []);
  assert.equal(held[0].sentence, 'The FBAR is due April 15.');
});

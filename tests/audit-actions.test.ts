// Tests for the audit follow-ups: AI text block, expert review, official sources, CTAs, length,
// duplicates, overdue reviews, time-left estimates, byline and schema.
// lib/anthropic loads the database client at import time; no query runs in these tests.
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiLeftovers, needsExpertReview, isOfficialSource, pickCta, DEFAULT_CTAS, withUtm, lengthTarget, sameTopic, duplicateOf, reviewOverdue, etaSeconds, scheduleAction, writingRuleIssues, validatePlan,
} from '../lib/strategy/core';
import { withByline, expertSchema } from '../lib/byline';
import { visibleWords } from '../lib/topLength';

test('AI instruction text and placeholders are caught', () => {
  assert.ok(aiLeftovers('<p>Here is your soft CTA section for the blog:</p>').length);
  assert.ok(aiLeftovers('<p>I hope this helps! Let me know if you would like changes.</p>').length);
  assert.ok(aiLeftovers('<p>Contact [Insert phone number] today.</p>').length);
  assert.ok(aiLeftovers('Meta description: file your FBAR').length);
  assert.equal(aiLeftovers('<p>Here is how the FBAR deadline works for NRIs in 2026.</p>').length, 0);
  assert.equal(aiLeftovers('<p>[PRACTITIONER NOTE NEEDED: add a case]</p>').length, 0);
  assert.ok(writingRuleIssues({ title: 'FBAR deadline guide', meta: 'short meta', html: '<p>Here is your draft article.</p>', siteHost: 'usaindiacfo.com' }).some((i) => /Remove/.test(i)));
});

test('tax, legal and compliance topics need an expert', () => {
  assert.ok(needsExpertReview('fbar filing deadline'));
  assert.ok(needsExpertReview('how to get an ITIN'));
  assert.ok(needsExpertReview('Delaware LLC for Indian founders'));
  assert.equal(needsExpertReview('how to hire a remote team in Bangalore'), false);
});

test('expert topics never auto-publish in review', () => {
  const row = { status: 'in_review', publish_at: '2026-10-01 10:00:00', review_started: '2026-09-28 10:00:00', reviewed_at: null, main_keyword: 'fbar filing deadline', title: 'FBAR deadline' };
  const later = new Date('2026-10-10T00:00:00Z');
  assert.equal(scheduleAction(row, later, 0, { requireExpert: true }), 'wait');
  assert.equal(scheduleAction(row, later, 0, { requireExpert: false }), 'publish');
  assert.equal(scheduleAction({ ...row, reviewed_at: '2026-09-29 10:00:00' }, later, 0, { requireExpert: true }), 'publish');
  assert.equal(reviewOverdue(row, later), true);
  assert.equal(reviewOverdue(row, new Date('2026-09-29T00:00:00Z')), false);
});

test('only official sites count as official sources', () => {
  assert.ok(isOfficialSource('https://www.irs.gov/forms-pubs/about-form-w-7'));
  assert.ok(isOfficialSource('https://incometaxindia.gov.in/Pages/acts.aspx'));
  assert.ok(isOfficialSource('https://revenue.wyo.gov/'));
  assert.ok(isOfficialSource('https://rbi.org.in/x'));
  assert.equal(isOfficialSource('https://cleartax.in/s/nri'), false);
  assert.equal(isOfficialSource('not a url'), false);
});

test('each blog gets the CTA of its service, with UTM tags', () => {
  assert.equal(pickCta(DEFAULT_CTAS, 'how to apply for itin from india')?.service, 'ITIN');
  assert.equal(pickCta(DEFAULT_CTAS, 'delaware llc for indian founders')?.service, 'US company formation');
  assert.equal(pickCta(DEFAULT_CTAS, 'tds on nri property sale')?.service, 'NRI and India tax');
  const u = new URL(withUtm('https://usaindiacfo.com/contact-us/', { campaign: 'itin-guide', content: 'itin' }));
  assert.equal(u.searchParams.get('utm_campaign'), 'itin-guide');
  assert.equal(u.searchParams.get('utm_source'), 'usaindiacfo_blog');
});

test('length target follows the pages ranking now', () => {
  const t = lengthTarget([1200, 2000, 2400, 3000, 150]);
  assert.equal(t.median, 2400);
  assert.equal(t.min, 1920);
  assert.equal(t.max, 3120);
  assert.equal(lengthTarget([900]).median, null);
  assert.equal(visibleWords('<nav>menu menu</nav><p>one two three</p><script>x y</script>'), 3);
});

test('duplicate topics are blocked', () => {
  assert.ok(sameTopic('FBAR filing deadline 2026', 'fbar filing deadline'));
  assert.ok(sameTopic('ITIN application process', 'itin application processes'));
  assert.equal(sameTopic('fbar deadline', 'itin deadline'), false);
  assert.equal(duplicateOf('form 5472 filing', [{ keyword: 'Form 5472 filing guide', where: 'x' }])?.where, 'x');
  const plan: any = { blogPlan: { calendar: [{ title: 'A', mainKeyword: 'fema ndi rules 2026', tags: ['SEO'] }, { title: 'B', mainKeyword: 'FEMA NDI rules', tags: ['SEO'] }] } };
  assert.ok(validatePlan(plan).errors.some((e) => /repeats the topic/.test(e)));
});

test('time left never freezes on a stuck percentage', () => {
  assert.equal(etaSeconds({ elapsed: 0, percent: 0, typical: 1500 }), 1500);
  const mid = etaSeconds({ elapsed: 600, percent: 50, typical: 1500 });
  assert.ok(mid > 600 && mid < 900);
  // At a frozen 18% the old formula returned 1230 for every elapsed value; now it changes.
  const a = etaSeconds({ elapsed: 300, percent: 18, typical: 1500 });
  const b = etaSeconds({ elapsed: 1320, percent: 18, typical: 1500 });
  assert.ok(b > a, 'a stuck step shows a growing estimate, never a frozen one');
  assert.ok(etaSeconds({ elapsed: 3000, percent: 3, typical: 1500 }) <= 3000, 'the pace term is capped');
  assert.ok(etaSeconds({ elapsed: 2000, percent: 0, typical: 1500 }) > 0);
});

test('fact-check claims are split into parallel batches', async () => {
  const { batchClaims } = await import('../lib/anthropic');
  assert.deepEqual(batchClaims(['a', 'b', 'a', ''], 3), [['a', 'b']]);
  const g = batchClaims(Array.from({ length: 30 }, (_, i) => `claim ${i}`), 3);
  assert.equal(g.length, 3);
  assert.equal(g.flat().length, 30);
  assert.equal(batchClaims(Array.from({ length: 12 }, (_, i) => `c${i}`), 3).length, 2);
});

test('the two clean rounds always come from two different models', async () => {
  const { verifyAndCorrect } = await import('../lib/anthropic');
  const run = async (verdicts: string[], startClean = 0) => {
    const models: string[] = [];
    let i = 0;
    const check = async (_d: any, _s: any, { model }: any) => {
      models.push(model);
      const v = verdicts[Math.min(i++, verdicts.length - 1)];
      return { checks: [{ claim: 'x', verdict: v, source_url: 'https://www.irs.gov/a', correction: 'y' }], model };
    };
    const r = await verifyAndCorrect({ title: 't', meta: 'm', content: '<p>x</p>', facts: [] }, { check, correct: async (d: any) => d, startClean, maxRounds: 6 });
    return { ok: r.ok, models };
  };
  assert.deepEqual((await run(['correct', 'correct'])).models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual((await run(['incorrect', 'correct', 'correct'])).models, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  assert.deepEqual((await run(['incorrect', 'correct', 'correct'], 1)).models, ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
});

test('a clean inline check counts as the first clean round, the other model does the second', async () => {
  const { verifyAndCorrect } = await import('../lib/anthropic');
  const models: string[] = [];
  const check = async (_d: any, _s: any, { model }: any) => {
    models.push(model);
    return { checks: [{ claim: 'x', verdict: 'correct', source_url: 'https://www.irs.gov/a' }], model };
  };
  const r = await verifyAndCorrect({ title: 't', meta: 'm', content: '<p>x</p>', facts: [] }, { check, correct: async (d: any) => d, startClean: 1, maxRounds: 5 });
  assert.equal(r.ok, true);
  assert.equal(models.length, 1, 'one more check was enough');
  assert.equal(models[0], 'claude-sonnet-5-5', 'the second model did it');
  assert.equal(r.rounds, 2);
});

test('byline and expert schema', () => {
  const html = withByline('<p>Answer first.</p><h2>Next</h2>', 'Harsh Jain', 'Akshay Nahar, CA', new Date('2026-10-07T00:00:00Z'));
  assert.match(html, /<p>Answer first.<\/p>\n<p class="uic-byline">By <strong>Harsh Jain<\/strong>. Reviewed by <strong>Akshay Nahar, CA<\/strong>. Last reviewed 7 October 2026.<\/p>/);
  const schema = expertSchema({ title: 'T', author: 'Harsh Jain', reviewer: 'Akshay Nahar, CA' }, new Date('2026-10-07T00:00:00Z'))!;
  const json = JSON.parse(schema.replace(/<\/?script[^>]*>/g, ''));
  assert.equal(json.reviewedBy.name, 'Akshay Nahar');
  assert.equal(json.reviewedBy.jobTitle, 'CA');
  assert.equal(json.mainEntity.author.name, 'Harsh Jain');
});

test('tracked SE Ranking keywords on the topic go into the blog keyword plan', async () => {
  const { chooseKeywords, planForPrompt } = await import('../lib/keywordPlanner');
  const plan = { secondary: [], questions: [], relatedSearches: [], surferTerms: [], tracked: [{ keyword: 'fbar penalty for nri', position: 12, volume: 300 }, { keyword: 'itin renewal', position: 5, volume: 900 }, { keyword: 'fbar deadline', position: 3, volume: 50 }] };
  const chosen: any = chooseKeywords(plan, 'fbar deadline');
  assert.deepEqual(chosen.tracked.map((t: any) => t.keyword), ['fbar penalty for nri']);
  assert.match(planForPrompt(chosen), /TRACKED IN SE RANKING[^\n]*fbar penalty for nri/);
});

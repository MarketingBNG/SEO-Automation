// Tests for the calendar autopilot fixes (review window, writing rules, rank check, fact check record,
// once-a-day jobs, approval and the rejected-rewrite stop). Pure checks run anywhere; the rest need a
// Postgres in DATABASE_URL (local test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleAction, writingRuleIssues, questionAnswerIssues, bestRankPerKeyword, TITLE_MAX } from '../lib/strategy/core';

// Nothing in these tests may reach an outside service.
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${url}`);
}) as any;

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
const hasDb = Boolean(process.env.DATABASE_URL);

test('a draft that never entered review gets its 48-hour review even after the slot', () => {
  const row = { status: 'planned', publish_at: '2026-11-03 04:30:00', draft_id: 7 };
  assert.equal(scheduleAction(row, new Date('2026-11-05T04:30:00Z')), 'open_review', 'past the slot, no review yet');
  assert.equal(scheduleAction({ ...row, draft_id: null }, new Date('2026-11-05T04:30:00Z')), 'publish', 'no draft: the publish step holds it');
  assert.equal(scheduleAction({ ...row, review_started: '2026-11-01 04:35:00' }, new Date('2026-11-05T04:30:00Z')), 'publish');
  assert.equal(scheduleAction({ ...row, reviewed_at: '2026-11-01 04:35:00' }, new Date('2026-11-05T04:30:00Z')), 'publish', 'approved by a person');
  assert.equal(scheduleAction({ ...row, status: 'held' }, new Date('2026-11-05T04:30:00Z')), 'publish');
});

test('the publish check and the writer use the same title limit and answer length', () => {
  const html = `<h2>What is X?</h2><p>${words(45)}</p><p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="https://www.irs.gov/x">irs</a></p><h2>Frequently Asked Questions</h2><h3>Q?</h3><p>${words(50)}</p>`;
  const rules = (title: string) => writingRuleIssues({ title, meta: 'Short meta', html, surferScore: 80, siteHost: 'usaindiacfo.com' });
  assert.deepEqual(rules('t'.repeat(TITLE_MAX)), [], 'a 60-character title, as the writer is told, passes');
  assert.equal(rules('t'.repeat(TITLE_MAX + 1)).length, 1);
  assert.deepEqual(questionAnswerIssues(html), []);
  assert.equal(questionAnswerIssues(`<h3>Why?</h3><p>${words(20)}</p>`).length, 1);
});

test('the rank check keeps the best engine per keyword', () => {
  const rows = [
    { keyword: 'itin', position: 3, engineId: 1 },
    { keyword: 'ITIN', position: 40, engineId: 2 },
    { keyword: 'ein', position: 0, engineId: 1 },
    { keyword: 'ein', position: 12, engineId: 2 },
    { keyword: 'fbar', position: null, engineId: 1 },
  ];
  const best = bestRankPerKeyword(rows);
  assert.equal(best.length, 3);
  assert.equal(best.find((r) => r.keyword.toLowerCase() === 'itin')!.position, 3);
  assert.equal(best.find((r) => r.keyword === 'ein')!.position, 12);
});

test('an edit never turns a failed fact check into a pass', { skip: !hasDb }, async () => {
  const { editedFactCheck } = await import('../lib/factCheckMark');
  const args = { stamp: '2026-11-01 10:00:00', textHash: 'h2', by: 'a@b.c', at: '2026-11-01 10:00:00' };
  const failed = editedFactCheck({ ok: false, rounds: 3, stamp: 'old', textHash: 'h1' }, args);
  assert.equal(failed.ok, false);
  assert.equal(failed.rounds, 3);
  assert.equal(failed.stamp, args.stamp);
  const passed = editedFactCheck({ ok: true, rounds: 1 }, args);
  assert.equal(passed.ok, true);
  assert.equal(passed.textHash, 'h2');
});

test('a once-a-day job stopped by paused AI work runs again; other failures close the day', { skip: !hasDb }, async () => {
  const { onceADay } = await import('../lib/onceADay');
  const { CreditPausedError } = await import('../lib/aiCredits');
  const settings = await import('../lib/settings');
  const key = `test_once_${Date.now()}`;
  await assert.rejects(onceADay(key, '2026-11-01', async () => { throw new CreditPausedError('AI work is paused: test'); }));
  assert.notEqual(await settings.get(key), '2026-11-01', 'left open after a credit pause');
  let ran = 0;
  await onceADay(key, '2026-11-01', async () => { ran++; });
  assert.equal(ran, 1);
  assert.equal(await settings.get(key), '2026-11-01');
  await onceADay(key, '2026-11-01', async () => { ran++; });
  assert.equal(ran, 1, 'not run twice the same day');
  await assert.rejects(onceADay(key, '2026-11-02', async () => { throw new Error('boom'); }));
  assert.equal(await settings.get(key), '2026-11-02', 'a real failure is not retried every 15 minutes');
});

test('only a strategy waiting for review can be approved', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { approveStrategy } = await import('../lib/strategy/service');
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'superseded', plan_json: '{}' } });
  await assert.rejects(approveStrategy(s.id, 'test'), (e: any) => e.status === 409);
  assert.equal(await prisma.blog_schedule.count({ where: { strategy_id: s.id } }), 0);
  await prisma.seo_strategies.delete({ where: { id: s.id } });
});

test('a rewrite that keeps failing is stopped, and one cut off by a restart is picked up again', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const settings = await import('../lib/settings');
  const { runDaily } = await import('../lib/strategy/autopilot');
  const today = new Date().toISOString().slice(0, 10);
  // The once-a-day steps after the calendar are not part of this test.
  for (const k of ['last_rank_check', 'last_outreach_run', 'last_speed_run', 'last_site_check']) await settings.set(k, today);
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const far = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const base = { strategy_id: s.id, publish_at: far, title: 'Test blog', main_keyword: `test kw ${Date.now()}`, tags: '[]' };
  const rejected = await prisma.blog_schedule.create({ data: { ...base, status: 'rejected', reject_feedback: 'Shorter.' } });
  const cutOff = await prisma.blog_schedule.create({ data: { ...base, status: 'revising', main_keyword: `${base.main_keyword} 2` } });
  let writes = 0;
  const write = async () => {
    writes++;
    throw new Error('The AI declined this request.');
  };
  try {
    const r: any = await runDaily(new Date(), { write });
    assert.equal(writes, 1);
    assert.ok(r.errors.some((e: string) => e.includes('rewrite failed')));
    const first = await prisma.blog_schedule.findUnique({ where: { id: rejected.id } });
    assert.equal(first!.status, 'paused', 'stopped, not retried every 15 minutes');
    assert.equal(first!.paused_from, 'rejected');
    assert.equal((await prisma.blog_schedule.findUnique({ where: { id: cutOff.id } }))!.status, 'rejected', 'a rewrite cut off by a restart is rewritten again');
    await runDaily(new Date(), { write });
    assert.equal(writes, 2, 'the paused row is not written again; the other rejected row is');
  } finally {
    const kws = (await prisma.blog_schedule.findMany({ where: { strategy_id: s.id }, select: { main_keyword: true } })).map((r) => r.main_keyword);
    await prisma.keywords.deleteMany({ where: { keyword: { in: kws } } });
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

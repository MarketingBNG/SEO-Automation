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

test('an edit never turns a failed or missing fact check into a pass', { skip: !hasDb }, async () => {
  const { editedFactCheck } = await import('../lib/factCheckMark');
  const args = { stamp: '2026-11-01 10:00:00', textHash: 'h2', by: 'a@b.c', at: '2026-11-01 10:00:00' };
  // A failed check keeps its old stamp and hash, so the edited text is checked once more.
  const failedPrev = { ok: false, rounds: 3, stamp: 'old', textHash: 'h1' };
  assert.equal(editedFactCheck(failedPrev, args), failedPrev);
  // No full check yet (inline check only, or none): the edit does not count as checked.
  const inline = { inlineStamp: 'S1', inlineModel: 'm', inlineClaims: 5 };
  assert.equal(editedFactCheck(inline, args), inline);
  const empty = {};
  assert.equal(editedFactCheck(empty, args), empty);
  // A person's edit to a blog that passed is recorded as checked.
  const passed = editedFactCheck({ ok: true, rounds: 1, stamp: 'old', textHash: 'h1' }, { ...args, before: { textHash: 'h1', stamp: 'old' } });
  assert.equal(passed.ok, true);
  assert.equal(passed.textHash, 'h2');
  // An older record with only a stamp counts when the stamp matches the text before the edit.
  assert.equal(editedFactCheck({ ok: true, rounds: 1, stamp: 'old' }, { ...args, before: { stamp: 'old' } }).textHash, 'h2');
  // A passed check that no longer covers the text (an AI edit since, never checked) is not carried
  // over by a later person's save, so the AI's text is still checked once.
  const stale = { ok: true, rounds: 1, stamp: 'old', textHash: 'h1' };
  assert.equal(editedFactCheck(stale, { ...args, before: { textHash: 'h-ai', stamp: 'after-ai' } }), stale);
  assert.equal(editedFactCheck(stale, args), stale, 'no before-text given: not marked');
  // An AI edit (the Assistant, the issue fixer) is never recorded as checked.
  const okPrev = { ok: true, rounds: 1, stamp: 'old', textHash: 'h1' };
  assert.equal(editedFactCheck(okPrev, { ...args, byPerson: false }), okPrev);
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

// A writer result as researchAndWriteBlog returns it, for the rewrite tests below.
const written = (title: string) => ({
  title,
  meta: 'Meta',
  content: '<p>New text</p>',
  researchNotes: '',
  factCheck: null,
  productionState: 'READY_FOR_REVIEW',
  repairAttempts: 0,
  validation: { issues: [], warnings: [], wordCount: 2, passed: true },
  peopleAlsoAsk: [],
  keywordPlan: null,
  linkedin: null,
  lengthTarget: null,
  cta: null,
  facts: [],
});

test('a rewrite that fails after its new draft is saved resumes from that draft, with a new review', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const settings = await import('../lib/settings');
  const { runDaily } = await import('../lib/strategy/autopilot');
  const today = new Date().toISOString().slice(0, 10);
  for (const k of ['last_rank_check', 'last_outreach_run', 'last_speed_run', 'last_site_check']) await settings.set(k, today);
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  // The slot has passed and the earlier version's review window was opened days ago.
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await prisma.blog_schedule.create({
    data: { strategy_id: s.id, publish_at: past, title: 'Test blog', main_keyword: `rewrite kw ${Date.now()}`, tags: '[]', status: 'rejected', reject_feedback: 'Shorter.', review_started: past, reminded_at: past },
  });
  let writes = 0;
  const write = async () => {
    writes++;
    return written('Rewritten');
  };
  const verify = async () => {
    throw new Error('The database went away.');
  };
  try {
    await runDaily(new Date(), { write, verify });
    assert.equal(writes, 1);
    const after = await prisma.blog_schedule.findUnique({ where: { id: row.id } });
    assert.equal(after!.status, 'paused');
    assert.equal(after!.paused_from, 'planned', 'Resume opens the review of the new draft, it does not pay for another rewrite');
    assert.ok(after!.draft_id);
    assert.equal(after!.review_started, null, 'the old review window does not count for the new draft');
    assert.equal(after!.reminded_at, null);
    // Resumed: the new draft gets its review, never a publish without one.
    assert.equal(scheduleAction({ ...after!, status: 'planned' } as any, new Date()), 'open_review');
    // The failed fact check's saved steps are dropped, so Resume does not replay the same failure.
    assert.equal(await prisma.ai_replay.count({ where: { scope: { startsWith: `factcheck-${after!.draft_id}-` } } }), 0);
  } finally {
    const kws = (await prisma.keywords.findMany({ where: { keyword: row.main_keyword }, select: { id: true } })).map((k) => k.id);
    await prisma.drafts.deleteMany({ where: { keyword_id: { in: kws } } });
    await prisma.keywords.deleteMany({ where: { id: { in: kws } } });
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('a calendar draft that really failed drops its saved steps; one waiting for AI keeps them', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const settings = await import('../lib/settings');
  const { runDaily } = await import('../lib/strategy/autopilot');
  const { frozenInput } = await import('../lib/aiReplay');
  const { CreditPausedError } = await import('../lib/aiCredits');
  const today = new Date().toISOString().slice(0, 10);
  for (const k of ['last_rank_check', 'last_outreach_run', 'last_speed_run', 'last_site_check']) await settings.set(k, today);
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const soon = new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await prisma.blog_schedule.create({ data: { strategy_id: s.id, publish_at: soon, title: 'Test blog', main_keyword: `replay kw ${Date.now()}`, tags: '[]', status: 'planned' } });
  const scope = `blog-sched-${row.id}`;
  let fail: Error = new CreditPausedError('AI work is paused.');
  const write = async () => {
    await frozenInput('writer-brief', async () => 'brief');
    throw fail;
  };
  try {
    await runDaily(new Date(), { write });
    assert.equal(await prisma.ai_replay.count({ where: { scope, hash: { startsWith: 'input:' } } }), 1, 'kept for the run that continues after the pause');
    assert.equal(await prisma.ai_replay.count({ where: { scope, hash: 'meta:ai-wait' } }), 1, 'marked as waiting for AI, so its inputs do not expire');
    fail = new Error('Could not parse a valid blog draft.');
    await runDaily(new Date(), { write });
    assert.equal(await prisma.ai_replay.count({ where: { scope } }), 0, 'a real failure starts fresh after Resume');
  } finally {
    await prisma.ai_replay.deleteMany({ where: { scope } });
    await prisma.keywords.deleteMany({ where: { keyword: row.main_keyword } });
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('a lead Smartlead keeps refusing is given up on and does not block the other tasks', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { runOutreach } = await import('../lib/strategy/outreach');
  const saved = { fetch: globalThis.fetch, key: process.env.SMARTLEAD_API_KEY, campaign: process.env.SMARTLEAD_CAMPAIGN_ID };
  process.env.SMARTLEAD_API_KEY = 'test-key';
  process.env.SMARTLEAD_CAMPAIGN_ID = '1';
  const added: string[] = [];
  // Stubbed: each site's home page shows its contact email; Smartlead refuses bad-site.com only.
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.hostname === 'server.smartlead.ai') {
      if (init?.method === 'GET') return new Response('', { status: 404 });
      const email = JSON.parse(init.body).lead_list[0].email;
      if (email.endsWith('@bad-site.com')) return new Response('{"error":"invalid lead"}', { status: 400 });
      added.push(email);
      return Response.json({ ok: true });
    }
    return new Response(`<title>${u.hostname}</title><p>contact@${u.hostname}</p>`, { status: 200 });
  }) as any;
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const base = { strategy_id: s.id, method: 'Resource page outreach', our_page: '/itin', send_date: '2020-01-01', tags: '[]' };
  const bad = await prisma.backlink_tasks.create({ data: { ...base, target_site: 'bad-site.com' } });
  const good = await prisma.backlink_tasks.create({ data: { ...base, target_site: 'good-site.com' } });
  const line = async () => 'A line.';
  try {
    await runOutreach(new Date(), { checkLinks: false, line });
    assert.deepEqual(added, ['contact@good-site.com'], 'the next task is still pushed');
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: bad.id } }))!.status, 'planned', 'one refusal: tried again next run');
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: good.id } }))!.status, 'sent');
    await runOutreach(new Date(), { checkLinks: false, line });
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: bad.id } }))!.status, 'failed', 'refused twice: given up on');
  } finally {
    globalThis.fetch = saved.fetch;
    process.env.SMARTLEAD_API_KEY = saved.key || '';
    process.env.SMARTLEAD_CAMPAIGN_ID = saved.campaign || '';
    await prisma.backlink_tasks.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('an opening line that keeps failing is given up on after two runs', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { runOutreach } = await import('../lib/strategy/outreach');
  const saved = { fetch: globalThis.fetch, key: process.env.SMARTLEAD_API_KEY, campaign: process.env.SMARTLEAD_CAMPAIGN_ID };
  process.env.SMARTLEAD_API_KEY = 'test-key';
  process.env.SMARTLEAD_CAMPAIGN_ID = '1';
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url));
    if (u.hostname === 'server.smartlead.ai') return init?.method === 'GET' ? new Response('', { status: 404 }) : Response.json({ ok: true });
    return new Response(`<title>${u.hostname}</title><p>contact@${u.hostname}</p>`, { status: 200 });
  }) as any;
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const t = await prisma.backlink_tasks.create({ data: { strategy_id: s.id, method: 'Resource page outreach', our_page: '/itin', send_date: '2020-01-01', tags: '[]', target_site: 'no-line-site.com' } });
  let calls = 0;
  const line = async (task: any) => {
    if (task.id !== t.id) return 'A line.';
    calls++;
    throw new Error('Opening line: Claude did not return a marked line.');
  };
  try {
    await runOutreach(new Date(), { checkLinks: false, line });
    let row = (await prisma.backlink_tasks.findUnique({ where: { id: t.id } }))!;
    assert.equal(row.status, 'planned', 'one failure: tried again next run');
    assert.match(row.note || '', /^Opening line failed/);
    await runOutreach(new Date(), { checkLinks: false, line });
    row = (await prisma.backlink_tasks.findUnique({ where: { id: t.id } }))!;
    assert.equal(row.status, 'failed', 'failed twice: given up on');
    await runOutreach(new Date(), { checkLinks: false, line });
    assert.equal(calls, 2, 'not paid for again after giving up');
  } finally {
    globalThis.fetch = saved.fetch;
    process.env.SMARTLEAD_API_KEY = saved.key || '';
    process.env.SMARTLEAD_CAMPAIGN_ID = saved.campaign || '';
    await prisma.backlink_tasks.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('onceADay clears only its own run marker', { skip: !hasDb }, async () => {
  const settings = await import('../lib/settings');
  const { onceADay } = await import('../lib/onceADay');
  const key = `test_once_marker_${Date.now()}`;
  const later = JSON.stringify({ day: '2026-11-01', at: 1, by: 'a later run' });
  await onceADay(key, '2026-11-01', async () => {
    // A later run took over (this one looked stale to it) while this one was still going.
    await settings.set(`${key}_running`, later);
  });
  assert.equal(await settings.get(`${key}_running`), later);
  const { default: prisma } = await import('../lib/prisma');
  await prisma.settings.deleteMany({ where: { key: { startsWith: key } } });
});

test('a fresh run marker from the day before blocks the next day; a stale one does not', { skip: !hasDb }, async () => {
  const settings = await import('../lib/settings');
  const { onceADay } = await import('../lib/onceADay');
  const key = `test_once_nextday_${Date.now()}`;
  let ran = 0;
  await settings.set(`${key}_running`, JSON.stringify({ day: '2026-11-01', at: Date.now() - 25 * 3600000 }));
  assert.equal(await onceADay(key, '2026-11-02', async () => { ran++; }, 26 * 60), null);
  assert.equal(ran, 0, 'a batch run of the day before that is still waiting is not joined');
  await settings.set(`${key}_running`, JSON.stringify({ day: '2026-11-01', at: Date.now() - 27 * 3600000 }));
  await onceADay(key, '2026-11-02', async () => { ran++; }, 26 * 60);
  assert.equal(ran, 1, 'a stale marker left by a restart does not block');
  const { default: prisma } = await import('../lib/prisma');
  await prisma.settings.deleteMany({ where: { key: { startsWith: key } } });
});

test('a remembered Surfer editor that no longer exists is replaced, not retried for 7 days', { skip: !hasDb }, async () => {
  const settings = await import('../lib/settings');
  const { default: prisma } = await import('../lib/prisma');
  const { getTermsForKeyword } = await import('../lib/surfer');
  const kw = `surfer test ${Date.now()}`;
  const saved = { fetch: globalThis.fetch, key: process.env.SURFER_API_KEY, ws: process.env.SURFER_WORKSPACE_ID };
  process.env.SURFER_API_KEY = 'test';
  process.env.SURFER_WORKSPACE_ID = '9';
  await settings.set(`surfer-editor:${kw}`, JSON.stringify({ id: 111, at: Date.now() }));
  let created = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    const p = new URL(String(url)).pathname;
    if (p.endsWith('/content_editors/111')) return Response.json({ error: 'not found' }, { status: 404 });
    if (init?.method === 'POST') {
      created++;
      return Response.json({ id: 222, state: 'completed' });
    }
    if (p.endsWith('/content_editors/222/seo_guidelines/terms')) return Response.json({ terms: [{ term: 'itin' }] });
    return Response.json({}, { status: 404 });
  }) as any;
  try {
    const r: any = await getTermsForKeyword(kw);
    assert.equal(created, 1);
    assert.equal(r.editorId, 222);
    assert.equal(await prisma.settings.count({ where: { key: `surfer-editor:${kw}` } }), 0, 'no empty row left behind');
  } finally {
    globalThis.fetch = saved.fetch;
    process.env.SURFER_API_KEY = saved.key || '';
    process.env.SURFER_WORKSPACE_ID = saved.ws || '';
    await prisma.settings.deleteMany({ where: { key: { contains: kw } } });
    await prisma.settings.deleteMany({ where: { key: { startsWith: 'apicache:surfer-terms' } } });
  }
});

test('the steps after publishing are summed up for the Activity Log', { skip: !hasDb }, async () => {
  const { afterPublishSummary } = await import('../lib/strategy/autopilot');
  const s = afterPublishSummary({ indexNow: { ok: true }, seRankingTracking: { ok: false, error: 'quota' }, internalLinks: { ok: true, result: ['https://x.test/a'] } });
  assert.match(s, /seRankingTracking failed \(quota\)/);
  assert.match(s, /internal links added in https:\/\/x\.test\/a/);
  assert.match(afterPublishSummary({ indexNow: { ok: true } }), /every step after publishing worked/);
  assert.match(afterPublishSummary(null), /could not run/);
});

test('a topic whose finished blog was deleted before it was linked can be written again', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { linkTopicBlogs } = await import('../lib/topics');
  const t = await prisma.topics.create({ data: { day: '2026-11-01', title: `Test topic ${Date.now()}`, keywords: '["test kw"]', sources: '[]', status: 'blog' } });
  const notes = `Topic from the daily research (${t.day}): ${t.title}. Why now: . Keywords to use: test kw. Sources: .`;
  const kw = await prisma.keywords.create({ data: { keyword: 'test kw', batch_name: 'Topics', notes, status: 'drafted' } });
  try {
    const changed = await linkTopicBlogs([t]);
    assert.equal(changed.get(t.id)?.status, 'new');
  } finally {
    await prisma.topics.delete({ where: { id: t.id } });
    await prisma.keywords.delete({ where: { id: kw.id } });
  }
});

test('outreach waits for AI: a credit pause stops the run before any site, Smartlead or log work', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const settings = await import('../lib/settings');
  const { runOutreach } = await import('../lib/strategy/outreach');
  const { CreditPausedError } = await import('../lib/aiCredits');
  const saved = { fetch: globalThis.fetch, key: process.env.SMARTLEAD_API_KEY, campaign: process.env.SMARTLEAD_CAMPAIGN_ID, paused: await settings.get('ai_paused') };
  process.env.SMARTLEAD_API_KEY = 'test-key';
  process.env.SMARTLEAD_CAMPAIGN_ID = '1';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('no network in this test');
  }) as any;
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const t = await prisma.backlink_tasks.create({ data: { strategy_id: s.id, method: 'Resource page outreach', our_page: '/itin', send_date: '2020-01-01', tags: '[]', target_site: 'paused-site.com' } });
  try {
    await settings.set('ai_paused', '1');
    let lines = 0;
    await assert.rejects(runOutreach(new Date(), { checkLinks: false, line: async () => { lines++; return 'A line.'; } }), (e: any) => e instanceof CreditPausedError);
    assert.equal(calls, 0, 'no site crawl and no Smartlead lookup');
    assert.equal(lines, 0);
    assert.equal(await prisma.activity_log.count({ where: { action: 'backlink.failed', entity_id: t.id } }), 0);
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: t.id } }))!.status, 'planned');
    // An opening line that throws a credit error mid-run also stops the run instead of being logged.
    await settings.set('ai_paused', saved.paused || '0');
    globalThis.fetch = (async (url: any, init: any) => {
      const u = new URL(String(url));
      if (u.hostname === 'server.smartlead.ai') return new Response('', { status: 404 });
      return new Response(`<p>contact@${u.hostname}</p>`, { status: 200 });
    }) as any;
    await assert.rejects(runOutreach(new Date(), { checkLinks: false, line: async () => { throw new CreditPausedError('AI work is paused: test'); } }), (e: any) => e instanceof CreditPausedError);
    assert.equal(await prisma.activity_log.count({ where: { action: 'backlink.failed', entity_id: t.id } }), 0);
  } finally {
    await settings.set('ai_paused', saved.paused || '0');
    globalThis.fetch = saved.fetch;
    process.env.SMARTLEAD_API_KEY = saved.key || '';
    process.env.SMARTLEAD_CAMPAIGN_ID = saved.campaign || '';
    await prisma.backlink_tasks.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('a new version of a month keeps the started blogs of the same keyword instead of writing them twice', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { approveStrategy } = await import('../lib/strategy/service');
  const { keywordKey } = await import('../lib/strategy/core');
  const n = Date.now();
  const period = `test period ${n}`;
  const kw = (s: string) => `${s} r3 ${n}`;
  const blog = (k: string, tags: string[]) => ({ title: `Blog ${k}`, mainKeyword: k, tags, focusService: 'US tax', intent: 'informational', publishDate: '2099-01-10 04:30:00' });
  const m = (value: number | null) => ({ value, source: 'test', range: 'test' });
  const intents = ['informational', 'informational', 'informational', 'informational', 'informational', 'commercial', 'commercial', 'commercial', 'comparison', 'comparison'];
  const plan = {
    period,
    lastMonthTrend: { SEO: 5, AEO: 3, GEO: 10 },
    summary: { focus: 'x', declineNotes: {} },
    included: [{ item: 'Blogs', tags: ['SEO'] }],
    keywords: intents.map((intent, i) => ({ keyword: kw(`k${i}`), intent, tags: ['SEO'], focusService: 'US tax' })),
    blogPlan: { calendar: [blog(kw('started'), ['SEO']), blog(kw('new1'), ['AEO']), blog(kw('new2'), ['GEO']), blog(kw('new3'), ['SEO', 'AEO']), blog(kw('new4'), ['SEO'])] },
    aeoGeo: { items: [{ target: 'q', tags: ['AEO', 'GEO'] }] },
    backlinks: [],
    technical: { fixes: [], refreshes: [] },
    targets: [
      { channel: 'SEO', kpi: 'Clicks', lastMonth: m(100), target: 120 },
      { channel: 'AEO', kpi: 'Featured snippets', lastMonth: m(2), target: 4 },
      { channel: 'GEO', kpi: 'AI chat mentions', lastMonth: m(null), target: 3 },
      { channel: 'Signal', kpi: 'Organic leads', lastMonth: m(10), target: null },
    ],
  };
  const crawl = await prisma.technical_crawls.create({ data: { filename: 'test.csv' } });
  const v1 = await prisma.seo_strategies.create({ data: { period, status: 'approved', plan_json: '{}' } });
  const v2 = await prisma.seo_strategies.create({ data: { period, status: 'pending_review', plan_json: JSON.stringify(plan), version: 2 } });
  const base = { strategy_id: v1.id, publish_at: '2099-01-05 04:30:00', title: 'Old', tags: '[]' };
  const started = await prisma.blog_schedule.create({ data: { ...base, main_keyword: kw('started'), status: 'in_review', draft_id: 999999, review_started: '2099-01-01 00:00:00' } });
  const unwritten = await prisma.blog_schedule.create({ data: { ...base, main_keyword: kw('unwritten'), status: 'planned' } });
  const other = await prisma.blog_schedule.create({ data: { ...base, main_keyword: kw('other'), status: 'held', draft_id: 999998 } });
  for (const k of [kw('started'), kw('unwritten'), kw('other')]) await prisma.strategy_keywords.create({ data: { keyword_key: keywordKey(k), keyword: k, period, strategy_id: v1.id } });
  try {
    const r: any = await approveStrategy(v2.id, 'test');
    assert.equal(r.status, 'approved');
    const moved = await prisma.blog_schedule.findUnique({ where: { id: started.id } });
    assert.equal(moved!.strategy_id, v2.id, 'the started blog moves to the new version');
    assert.equal(moved!.status, 'in_review');
    assert.equal(moved!.draft_id, 999999);
    assert.equal(moved!.publish_at, '2099-01-10 04:30:00');
    assert.equal(await prisma.blog_schedule.count({ where: { main_keyword: kw('started') } }), 1, 'not scheduled (and paid for) twice');
    assert.equal(await prisma.blog_schedule.count({ where: { strategy_id: v2.id } }), 5);
    assert.equal(await prisma.blog_schedule.findUnique({ where: { id: unwritten.id } }), null);
    assert.equal(await prisma.strategy_keywords.count({ where: { keyword_key: keywordKey(kw('unwritten')) } }), 0, 'freed');
    const paused = await prisma.blog_schedule.findUnique({ where: { id: other.id } });
    assert.equal(paused!.status, 'paused');
    assert.equal(paused!.paused_from, 'held');
    assert.equal((await prisma.strategy_keywords.findUnique({ where: { keyword_key: keywordKey(kw('started')) } }))!.strategy_id, v2.id);
  } finally {
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: { in: [v1.id, v2.id] } } });
    await prisma.strategy_keywords.deleteMany({ where: { period } });
    await prisma.backlink_tasks.deleteMany({ where: { strategy_id: { in: [v1.id, v2.id] } } });
    await prisma.technical_fix_tasks.deleteMany({ where: { strategy_id: { in: [v1.id, v2.id] } } });
    await prisma.activity_log.deleteMany({ where: { entity_type: 'seo_strategy', entity_id: v2.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: { in: [v1.id, v2.id] } } });
    await prisma.technical_crawls.delete({ where: { id: crawl.id } });
  }
});

test('blogs of a strategy replaced earlier are stopped visibly by the scheduler pass', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { stopSupersededRows } = await import('../lib/strategy/replaced');
  const { keywordKey } = await import('../lib/strategy/core');
  const n = Date.now();
  const s = await prisma.seo_strategies.create({ data: { period: `test ${n}`, status: 'superseded', plan_json: '{}' } });
  const base = { strategy_id: s.id, publish_at: '2099-01-05 04:30:00', title: 'Old', tags: '[]' };
  const review = await prisma.blog_schedule.create({ data: { ...base, main_keyword: `sup a ${n}`, status: 'in_review', draft_id: 999997 } });
  const unwritten = await prisma.blog_schedule.create({ data: { ...base, main_keyword: `sup b ${n}`, status: 'planned' } });
  const writing = await prisma.blog_schedule.create({ data: { ...base, main_keyword: `sup c ${n}`, status: 'drafting' } });
  await prisma.strategy_keywords.create({ data: { keyword_key: keywordKey(`sup b ${n}`), keyword: `sup b ${n}`, period: `test ${n}`, strategy_id: s.id } });
  try {
    const r = await stopSupersededRows('2099-01-01 00:00:00');
    assert.ok(r.paused.some((x: any) => x.id === review.id));
    assert.equal((await prisma.blog_schedule.findUnique({ where: { id: review.id } }))!.status, 'paused');
    assert.equal(await prisma.blog_schedule.findUnique({ where: { id: unwritten.id } }), null);
    assert.equal(await prisma.strategy_keywords.count({ where: { keyword_key: keywordKey(`sup b ${n}`) } }), 0);
    assert.equal((await prisma.blog_schedule.findUnique({ where: { id: writing.id } }))!.status, 'drafting', 'a row being written is left until its write ends');
    // The write ends: the next pass stops it.
    await prisma.blog_schedule.update({ where: { id: writing.id }, data: { status: 'planned', draft_id: 999996 } });
    await stopSupersededRows('2099-01-01 00:00:00');
    assert.equal((await prisma.blog_schedule.findUnique({ where: { id: writing.id } }))!.status, 'paused');
    const again = await stopSupersededRows('2099-01-01 00:00:00');
    assert.equal(again.paused.filter((x: any) => x.id === review.id || x.id === writing.id).length, 0, 'idempotent');
  } finally {
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: s.id } });
    await prisma.strategy_keywords.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

test('a blog waiting for AI keeps its frozen inputs past 3 days; a fresh run rebuilds them', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { withReplay, frozenInput, markAiWait, clearReplay } = await import('../lib/aiReplay');
  const scope = `blog-test-${Date.now()}`;
  const old = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  try {
    await withReplay(scope, () => frozenInput('writer-brief', async () => 'old brief'));
    await prisma.ai_replay.updateMany({ where: { scope }, data: { created_at: old } });
    assert.equal(await withReplay(scope, () => frozenInput('writer-brief', async () => 'new brief')), 'new brief', 'stale and not waiting: rebuilt');
    await prisma.ai_replay.updateMany({ where: { scope }, data: { created_at: old } });
    await markAiWait(scope);
    assert.equal(await withReplay(scope, () => frozenInput('writer-brief', async () => 'newer brief')), 'new brief', 'waiting for AI: kept');
  } finally {
    await clearReplay(scope);
  }
});

test('the best engine row of a keyword counts, also when another engine has no position yet', async () => {
  const { oneRowPerKeyword } = await import('../lib/seranking');
  const rows = oneRowPerKeyword([
    { keyword: 'a', position: null },
    { keyword: 'A', position: 4 },
    { keyword: 'b', position: 0 },
    { keyword: 'b', position: 12 },
    { keyword: 'c', position: null },
  ]);
  assert.deepEqual(rows.map((r: any) => r.position), [4, 12, null]);
});

test('deleting a live topic blog that was never linked links it, so the topic is not written again', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { linkTopicBlogs, linkLiveTopic } = await import('../lib/topics');
  const t = await prisma.topics.create({ data: { day: '2026-11-02', title: `Live topic ${Date.now()}`, keywords: '["live kw"]', sources: '[]', status: 'blog' } });
  const notes = `Topic from the daily research (${t.day}): ${t.title}. Why now: . Keywords to use: live kw. Sources: .`;
  const kw = await prisma.keywords.create({ data: { keyword: 'live kw', batch_name: 'Topics', notes, status: 'drafted' } });
  try {
    assert.equal(await linkLiveTopic(prisma, 999995, notes), 1);
    const row = await prisma.topics.findUnique({ where: { id: t.id } });
    assert.equal(row!.draft_id, 999995);
    assert.equal((await linkTopicBlogs([row])).size, 0, 'not put back to new');
  } finally {
    await prisma.topics.delete({ where: { id: t.id } });
    await prisma.keywords.delete({ where: { id: kw.id } });
  }
});

test('a calendar blog whose slot passed with no draft is written, not held for good', { skip: !hasDb }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const settings = await import('../lib/settings');
  const { runDaily } = await import('../lib/strategy/autopilot');
  const today = new Date().toISOString().slice(0, 10);
  for (const k of ['last_rank_check', 'last_outreach_run', 'last_speed_run', 'last_site_check']) await settings.set(k, today);
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await prisma.blog_schedule.create({ data: { strategy_id: s.id, publish_at: past, title: 'Test blog', main_keyword: `late kw ${Date.now()}`, tags: '[]', status: 'planned' } });
  let writes = 0;
  const write = async () => {
    writes++;
    return written('Late blog');
  };
  try {
    await runDaily(new Date(), { write });
    assert.equal(writes, 1);
    const after = await prisma.blog_schedule.findUnique({ where: { id: row.id } });
    assert.notEqual(after!.status, 'held');
    assert.ok(after!.draft_id);
    assert.equal(scheduleAction(after as any, new Date()), 'open_review', 'its review opens next');
  } finally {
    const kws = (await prisma.keywords.findMany({ where: { keyword: row.main_keyword }, select: { id: true } })).map((k) => k.id);
    await prisma.drafts.deleteMany({ where: { keyword_id: { in: kws } } });
    await prisma.keywords.deleteMany({ where: { id: { in: kws } } });
    await prisma.blog_schedule.deleteMany({ where: { strategy_id: s.id } });
    await prisma.seo_strategies.delete({ where: { id: s.id } });
  }
});

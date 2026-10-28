// Review round 13: a publishing pause keeps a held blog's real reasons (no repeat notice when it
// starts or ends), once-a-day jobs stay open when nothing could be done, missing connections answer
// "Not connected" instead of a server error, and a hand edit of the skill neither loses nor is lost
// to the automatic refresh's paid batch. Database tests use DATABASE_URL (local test database only).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdChanged, keepSkippedReasons } from '../lib/strategy/autopilot';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service.
process.env.SLACK_WEBHOOK_URL = '';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url instanceof Request ? url.url : url)}`);
}) as any;

// Runs fn with these environment variables set (undefined: removed), then puts them back.
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const NO_WP = { WORDPRESS_SITE_URL: undefined, WORDPRESS_USERNAME: undefined, WORDPRESS_APPLICATION_PASSWORD: undefined, SITE_CONNECTOR_URL: undefined, SITE_CONNECTOR_SECRET: undefined };

test('a publishing pause keeps a held blog\'s skipped-check reasons, so it sends no notice when it starts or ends', () => {
  const pause = 'Auto-publishing paused: the site returned 503.';
  const fc = 'Fact check could not confirm every claim from a primary source after 3 rounds.';
  const orig = 'Plagiarism check: 40 words in a row (5% of the blog) match https://x.test. Rewrite those passages in your own words, then check again.';
  const rule = 'Meta description is too long.';
  // Pause starts on a blog held for its fact check: the reason stays, and nothing changed.
  const during = keepSkippedReasons(JSON.stringify([fc]), [pause]);
  assert.deepEqual(during, [pause, fc]);
  assert.equal(holdChanged(JSON.stringify([fc]), during), false, 'pause starting: no notice');
  // Pause ends, the cached fact check fails again: no notice either.
  assert.equal(holdChanged(JSON.stringify(during), [fc]), false, 'pause ending: no notice');
  // Order does not matter, and a checked rule that is fixed during the pause is not carried.
  assert.deepEqual(keepSkippedReasons(JSON.stringify([rule, orig]), [pause]), [pause, orig]);
  assert.equal(holdChanged(JSON.stringify([orig, rule]), [rule, orig]), false);
  // A real change still counts.
  assert.equal(holdChanged(JSON.stringify([pause, fc]), [fc, rule]), true);
  assert.deepEqual(keepSkippedReasons('not json', [pause]), [pause]);
  assert.deepEqual(keepSkippedReasons(JSON.stringify([pause, 'Surfer score is 60; it must be 75 or more.']), [pause]), [pause, 'Surfer score is 60; it must be 75 or more.']);
});

test('connection tests answer Not connected (200, connected:false) when nothing is set up', async () => {
  await withEnv({ ...NO_WP, GOOGLE_SERVICE_ACCOUNT_KEY_JSON: undefined, GOOGLE_SERVICE_ACCOUNT_KEY_PATH: undefined, SERANKING_API_KEY: undefined, SURFER_API_KEY: undefined, SERPHOUSE_API_KEY: undefined }, async () => {
    for (const name of ['wordpress', 'gsc', 'seranking', 'surfer', 'serphouse']) {
      const { GET } = await import(`../app/api/${name}/test/route`);
      const res = await GET(new Request('http://localhost/x'));
      assert.equal(res.status, 200, name);
      const j = await res.json();
      assert.equal(j.ok, false, name);
      assert.equal(j.connected, false, name);
      assert.ok(j.error, name);
    }
  });
});

test('site checks and speed work report an error when nothing could be done, so the day stays open', { skip: !db, timeout: 60000 }, async () => {
  await withEnv(NO_WP, async () => {
    const { runSiteChecks } = await import('../lib/siteChecks');
    const site: any = await runSiteChecks();
    assert.ok(site.error, 'no website connection: not marked done');
    assert.match(String(site.aiText), /^not checked/);
    const { runSpeedFixes } = await import('../lib/strategy/speed');
    const prisma = (await import('../lib/prisma')).default;
    // A cache row (from an earlier run on this database) makes the cache step a skip, not an error.
    if (!(await prisma.technical_fix_tasks.count({ where: { strategy_id: 0, kind: 'cache' } }))) {
      const speed: any = await runSpeedFixes();
      assert.ok(speed.cache?.error && speed.images?.error);
      assert.ok(speed.error, 'both steps failed: not marked done');
    }
  });
});

test('the outreach link check: no SE Ranking key is not an error, an SE Ranking failure is', { skip: !db, timeout: 60000 }, async () => {
  const { checkOutreachLinks } = await import('../lib/strategy/outreach');
  const sent = [{ id: -1, status: 'sent', target_site: 'https://linker.test' }];
  await withEnv({ SERANKING_API_KEY: undefined }, async () => {
    assert.deepEqual(await checkOutreachLinks(new Date(), sent), { verified: 0 });
  });
  // A domain no earlier run cached, so the (blocked) live call is made and fails.
  await withEnv({ SERANKING_API_KEY: 'test-key', WORDPRESS_SITE_URL: `https://r13-${Date.now()}.test` }, async () => {
    const r = await checkOutreachLinks(new Date(), sent);
    assert.equal(r.verified, 0);
    assert.match(String(r.error), /SE Ranking link check failed/);
  });
  assert.deepEqual(await checkOutreachLinks(new Date(), []), { verified: 0 }, 'nothing sent: nothing to check');
});

test('a hand edit while the skill refresh batch waits keeps that batch findable, and is refused', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const settings = await import('../lib/settings');
  const { skillBatchWaiting, skillPendingKey } = await import('../lib/anthropic');
  const activeBefore = await prisma.writing_skills.findMany({ where: { status: 'active' }, select: { id: true } });
  const savedCycle = await settings.get('skill_refresh_ga4');
  const made: number[] = [];
  let pendingKey = '';
  try {
    await prisma.writing_skills.updateMany({ where: { status: 'active' }, data: { status: 'superseded' } });
    const base = await prisma.writing_skills.create({ data: { skill_content: 'Round 13 base skill', status: 'active' } });
    made.push(base.id);
    const note = `Round 13 note ${Date.now()}`;
    await settings.set('skill_refresh_ga4', JSON.stringify({ at: Date.now(), note, previousId: base.id }));
    pendingKey = skillPendingKey(note, base);
    await settings.set(pendingKey, JSON.stringify({ id: 'msgbatch_test', at: Date.now() }));
    assert.equal(await skillBatchWaiting(), true);
    // A hand edit made anyway (as before this fix): the batch is still found, by the version it was sent on.
    await prisma.writing_skills.updateMany({ where: { status: 'active' }, data: { status: 'superseded' } });
    const edit = await prisma.writing_skills.create({ data: { skill_content: 'Round 13 edited skill', status: 'active' } });
    made.push(edit.id);
    assert.equal(await skillBatchWaiting(), true, 'the paid batch is not lost to the edit');
    // The edit route refuses while it waits.
    const { POST } = await import('../app/api/skill/route');
    const res = await POST(new Request('http://localhost/api/skill', { method: 'POST', body: JSON.stringify({ skill_content: 'x' }) }) as any);
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /automatic skill refresh/);
    assert.equal(await prisma.writing_skills.count({ where: { status: 'active', id: { notIn: made } } }), 0, 'nothing saved');
  } finally {
    if (pendingKey) await prisma.settings.deleteMany({ where: { key: pendingKey } });
    if (savedCycle == null) await prisma.settings.deleteMany({ where: { key: 'skill_refresh_ga4' } });
    else await settings.set('skill_refresh_ga4', savedCycle);
    await prisma.writing_skills.deleteMany({ where: { id: { in: made } } });
    if (activeBefore.length) await prisma.writing_skills.updateMany({ where: { id: { in: activeBefore.map((r) => r.id) } }, data: { status: 'active' } });
  }
});

test('Testing mode pauses a strategy with its own reason, which the resume logic still finds', async () => {
  const { TESTING_PAUSED } = await import('../lib/strategy/jobs');
  assert.match(TESTING_PAUSED, /^Paused: Testing mode/);
  assert.doesNotMatch(TESTING_PAUSED, /credits low/);
  const src = (await import('node:fs')).readFileSync(new URL('../lib/aiReplay.ts', import.meta.url), 'utf8');
  assert.match(src, /startsWith: 'Paused: Testing mode'/);
});

test.after(() => {
  globalThis.fetch = realFetch;
});

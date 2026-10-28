// Review round 14: speed work stays open for the day when the website is down even after the cache
// step was handled on an earlier day, a reused skill refresh cycle keeps a hand edit unless a paid
// batch waits on the older version, and the credit auto-resume leaves strategies paused in Testing
// mode. Database tests use DATABASE_URL (local test database only).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillCycleBasis } from '../lib/anthropic';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service.
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url instanceof Request ? url.url : url)}`);
}) as any;

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

test('a reused skill cycle is built on the older version only while a paid batch sent on it waits', () => {
  const older = { id: 5, skill_content: 'older' };
  const active = { id: 6, skill_content: 'hand edit' };
  assert.equal(skillCycleBasis({ basis: older, batchPending: true }, active), older, 'the batch is found by the version it was sent on');
  assert.equal(skillCycleBasis({ basis: older, batchPending: false }, active), active, 'no batch: the hand edit is kept');
  assert.equal(skillCycleBasis({ basis: null, batchPending: false }, active), active);
  assert.equal(skillCycleBasis({ basis: older, batchPending: false }, null), null);
});

test('speed work reports an error when images fail and the cache step was already handled', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  let made: number | null = null;
  try {
    if (!(await prisma.technical_fix_tasks.count({ where: { strategy_id: 0, kind: 'cache' } }))) {
      made = (await prisma.technical_fix_tasks.create({ data: { strategy_id: 0, url: 'https://r14.test', issue: 'Page caching', fix: 'test', kind: 'cache', status: 'applied', result: 'round 14 test' } })).id;
    }
    await withEnv(NO_WP, async () => {
      const { runSpeedFixes } = await import('../lib/strategy/speed');
      const speed: any = await runSpeedFixes();
      assert.ok(speed.cache?.skipped, 'cache step skipped');
      assert.ok(speed.images?.error, 'no website connection: images failed');
      assert.ok(speed.error, 'nothing was done: the day stays open');
    });
  } finally {
    if (made != null) await prisma.technical_fix_tasks.deleteMany({ where: { id: made } });
  }
});

test('the credit auto-resume leaves paused strategies alone in Testing mode', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const g = globalThis as any;
  const prevPin = g.__AI_MODE_PIN;
  const row = await prisma.seo_strategies.create({ data: { period: `r14-${Date.now()}`, status: 'paused', progress_stage: 'Paused: Testing mode (round 14 test)' } });
  try {
    g.__AI_MODE_PIN = 'testing';
    const { resumeCreditPaused } = await import('../lib/aiReplay');
    assert.equal(await resumeCreditPaused(), null);
    const after = await prisma.seo_strategies.findUnique({ where: { id: row.id } });
    assert.equal(after?.status, 'paused');
    assert.match(String(after?.progress_stage), /^Paused: Testing mode/);
  } finally {
    g.__AI_MODE_PIN = prevPin;
    await prisma.seo_strategies.deleteMany({ where: { id: row.id } });
  }
});

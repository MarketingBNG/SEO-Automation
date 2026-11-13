// Review round 14: a reused skill refresh cycle keeps a hand edit unless a paid batch waits on the
// older version, and the credit auto-resume leaves strategies paused in Testing
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

test('a reused skill cycle is built on the older version only while a paid batch sent on it waits', () => {
  const older = { id: 5, skill_content: 'older' };
  const active = { id: 6, skill_content: 'hand edit' };
  assert.equal(skillCycleBasis({ basis: older, batchPending: true }, active), older, 'the batch is found by the version it was sent on');
  assert.equal(skillCycleBasis({ basis: older, batchPending: false }, active), active, 'no batch: the hand edit is kept');
  assert.equal(skillCycleBasis({ basis: null, batchPending: false }, active), active);
  assert.equal(skillCycleBasis({ basis: older, batchPending: false }, null), null);
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

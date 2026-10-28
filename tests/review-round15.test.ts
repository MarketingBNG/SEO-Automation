// Review round 15: switching to Live mode while AI credits are still paused restarts nothing, since
// a blog left waiting for credits would only stop again at its first AI call.
// Database tests use DATABASE_URL (local test database only).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service.
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url instanceof Request ? url.url : url)}`);
}) as any;

test('the credit resume restarts nothing in Live mode while AI work is still paused', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const settings = await import('../lib/settings');
  const g = globalThis as any;
  const prevPin = g.__AI_MODE_PIN;
  const prevPaused = await settings.get('ai_paused');
  const kw = await prisma.keywords.create({ data: { keyword: `r15 ${Date.now()}`, status: 'pending', error: 'AI work is paused (round 15 test)' } });
  const row = await prisma.seo_strategies.create({ data: { period: `r15-${Date.now()}`, status: 'paused', progress_stage: 'Paused: AI credits (round 15 test)' } });
  try {
    g.__AI_MODE_PIN = 'live';
    await settings.set('ai_paused', '1');
    const { resumeCreditPaused } = await import('../lib/aiReplay');
    assert.equal(await resumeCreditPaused(), null);
    const k = await prisma.keywords.findUnique({ where: { id: kw.id } });
    assert.equal(k?.status, 'pending', 'the blog is not claimed while credits are paused');
    const s = await prisma.seo_strategies.findUnique({ where: { id: row.id } });
    assert.equal(s?.status, 'paused');
    assert.match(String(s?.progress_stage), /^Paused: AI credits/);
  } finally {
    await settings.set('ai_paused', prevPaused || '0');
    g.__AI_MODE_PIN = prevPin;
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: row.id } });
  }
});

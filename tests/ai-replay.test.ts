// Resumable runs (lib/aiReplay.ts): frozen prompt inputs and the pruning of saved steps.
// Needs a local database: DATABASE_URL=postgresql://... node --import tsx --test tests/ai-replay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = !!process.env.DATABASE_URL;

test('frozenInput: a later attempt of the same run reads the first value back', { skip: !db }, async () => {
  const { withReplay, frozenInput, clearReplay } = await import('../lib/aiReplay');
  const scope = `test-frozen-${Date.now()}`;
  let n = 0;
  const build = async () => ({ value: ++n });
  const first = await withReplay(scope, () => frozenInput('brief', build));
  const second = await withReplay(scope, () => frozenInput('brief', build));
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  // each: every read in the attempt is saved in order, so a value that changed between rounds keeps its own.
  const a = await withReplay(scope, async () => [await frozenInput('mem', build, { each: true }), await frozenInput('mem', build, { each: true })]);
  const b = await withReplay(scope, async () => [await frozenInput('mem', build, { each: true }), await frozenInput('mem', build, { each: true })]);
  assert.deepEqual(b, a);
  assert.notDeepEqual(a[0], a[1]);
  // Outside a run nothing is saved.
  assert.deepEqual(await frozenInput('brief', async () => 'live'), 'live');
  await clearReplay(scope);
});

test('pruneReplay keeps the old steps of a run still waiting to resume', { skip: !db }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { pruneReplay } = await import('../lib/aiReplay');
  const kw = await prisma.keywords.create({ data: { keyword: `prune test ${Date.now()}`, status: 'pending', error: 'AI work is paused' } });
  const old = '2000-01-01 00:00:00';
  await prisma.ai_replay.createMany({ data: [
    { scope: `blog-${kw.id}`, hash: 'h1', result: '{}', created_at: old },
    { scope: 'blog-999999999', hash: 'h1', result: '{}', created_at: old },
  ] });
  await pruneReplay();
  const left = await prisma.ai_replay.findMany({ where: { scope: { in: [`blog-${kw.id}`, 'blog-999999999'] } } });
  assert.deepEqual(left.map((r) => r.scope), [`blog-${kw.id}`]);
  await prisma.ai_replay.deleteMany({ where: { scope: `blog-${kw.id}` } });
  await prisma.keywords.delete({ where: { id: kw.id } });
});

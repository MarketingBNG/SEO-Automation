// A tool that never answers must not stall strategy generation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

test('a step that never answers is given up after its time limit', async () => {
  const { limit } = await import('../lib/strategy/inputs');
  const never = new Promise(() => {});
  const t = Date.now();
  await assert.rejects(limit(never, 0.01, 'SE Ranking backlink gap'), /SE Ranking backlink gap did not answer within 0.01 minute/);
  assert.ok(Date.now() - t < 3000);
  assert.equal(await limit(Promise.resolve(7), 1, 'fast step'), 7);
});

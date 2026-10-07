// Progress: a new stage is always saved at once (so the bar never sits on an old step); repeats of
// the same stage are limited to one write every 2 seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

test('new stages are written immediately, repeats are throttled', async () => {
  const { progressWriter } = await import('../lib/strategy/jobs');
  const written: string[] = [];
  const w = progressWriter(async (stage, pct) => written.push(`${stage}:${pct}`));
  w('Keyword plan ready', 15);
  w('Researching sources & writing the draft', 18);
  w('Researching sources & writing the draft', 18);
  assert.deepEqual(written, ['Keyword plan ready:15', 'Researching sources & writing the draft:18']);
});

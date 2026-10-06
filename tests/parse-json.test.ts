// Reading the strategy JSON from Claude's reply in the shapes it can come back in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = async () => (await import('../lib/strategy/generate')).parseJson;

test('JSON between the markers, with prose before it', async () => {
  const parseJson = await load();
  assert.deepEqual(parseJson('The last research step showed X.\n===JSON===\n{"a":1}\n===END==='), { a: 1 });
});

test('JSON in a code fence, or a bare object after prose', async () => {
  const parseJson = await load();
  assert.deepEqual(parseJson('Here it is:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJson('The last results suggest... {"a":3,"b":{"c":[1]}} done.'), { a: 3, b: { c: [1] } });
  assert.deepEqual(parseJson('===JSON===\n{"a":4}'), { a: 4 }); // end marker missing
});

test('prose only (the failure in the screenshot) is reported, not guessed', async () => {
  const parseJson = await load();
  assert.throws(() => parseJson('The last r'), /JSON/);
});

// A kept batch that is dropped (cancelled or too old) is sent again with the key in use now, not
// with the key that sent the old one. Needs a local database:
// DATABASE_URL=postgresql://... node --import tsx --test tests/batch-key.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = !!process.env.DATABASE_URL;
const MSG = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
const batch = (id: string, extra: any = {}) => ({ id, type: 'message_batch', processing_status: 'ended', created_at: new Date().toISOString(), cancel_initiated_at: null, results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results`, ...extra });

test('a cancelled kept batch from the secondary key is sent again on the main key in use now', { skip: !db }, async () => {
  process.env.ANTHROPIC_API_KEY = 'main';
  process.env.ANTHROPIC_API_KEY_SECONDARY = 'second';
  const { anthropicClient, retryMainKey, keyInUse } = await import('../lib/anthropicClient');
  const { requestHash } = await import('../lib/aiReplay');
  const settings = await import('../lib/settings');
  const { runBatchTurn } = await import('../lib/anthropic');
  retryMainKey();
  assert.equal(keyInUse(), 'main');
  const params = { model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: `batch key test ${Date.now()}` }] };
  const pendingKey = `batch_pending:${requestHash(params)}`;
  await settings.set(pendingKey, JSON.stringify({ id: 'old_batch', at: Date.now(), key: 'secondary' }));
  const calls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const key = new Headers(init?.headers).get('x-api-key') || '';
    const u = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${new URL(u).pathname} ${key}`);
    const json = (b: any) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (method === 'POST') return json(batch('new_batch'));
    if (u.endsWith('/old_batch')) return json(batch('old_batch', { cancel_initiated_at: new Date().toISOString() }));
    if (u.endsWith('/results')) return new Response(JSON.stringify({ custom_id: 'turn', result: { type: 'succeeded', message: MSG } }) + '\n', { status: 200, headers: { 'content-type': 'application/binary' } });
    return json(batch('new_batch'));
  }) as typeof fetch;
  try {
    const msg: any = await runBatchTurn(anthropicClient(), params, undefined);
    assert.equal(msg.content[0].text, 'hi');
    // The old batch is looked up with the key that sent it; the new one goes out on the main key.
    assert.ok(calls.includes('GET /v1/messages/batches/old_batch second'), calls.join('\n'));
    assert.ok(calls.includes('POST /v1/messages/batches main'), calls.join('\n'));
    assert.ok(!calls.some((c) => c.startsWith('POST') && c.endsWith(' second')), calls.join('\n'));
  } finally {
    const prisma = (await import('../lib/prisma')).default;
    await prisma.settings.deleteMany({ where: { key: pendingKey } }).catch(() => {});
  }
});

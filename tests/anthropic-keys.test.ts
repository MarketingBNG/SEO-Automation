// The secondary Anthropic key takes over when the main key is out of credit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

const OK = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
const NO_CREDIT = { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } };

function fakeApi(outOfCredit: Set<string>) {
  const keysSeen: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const key = new Headers(init?.headers).get('x-api-key') || '';
    keysSeen.push(key);
    const body = outOfCredit.has(key) ? NO_CREDIT : OK;
    return new Response(JSON.stringify(body), { status: outOfCredit.has(key) ? 400 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return keysSeen;
}
const ask = (client: any) => client.messages.create({ model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });

test('main key out of credit: the same request goes to the secondary key, and later ones start there', async () => {
  process.env.ANTHROPIC_API_KEY = 'main';
  process.env.ANTHROPIC_API_KEY_SECONDARY = 'second';
  const { anthropicClient, keyInUse, retryMainKey } = await import('../lib/anthropicClient');
  retryMainKey();
  const seen = fakeApi(new Set(['main']));
  const msg = await ask(anthropicClient());
  assert.equal(msg.content[0].text, 'hi');
  assert.deepEqual(seen, ['main', 'second']);
  assert.equal(keyInUse(), 'secondary');
  await ask(anthropicClient());
  assert.deepEqual(seen.slice(2), ['second']);
  // After a top-up the main key is used again.
  retryMainKey();
  fakeApi(new Set());
  assert.equal(keyInUse(), 'main');
});

test('both keys out of credit, or no secondary key: the credit error reaches the caller', async () => {
  const { anthropicClient, retryMainKey } = await import('../lib/anthropicClient');
  retryMainKey();
  fakeApi(new Set(['main', 'second']));
  await assert.rejects(ask(anthropicClient()), /credit balance is too low/);
  retryMainKey();
  delete process.env.ANTHROPIC_API_KEY_SECONDARY;
  const seen = fakeApi(new Set(['main']));
  await assert.rejects(ask(anthropicClient()), /credit balance is too low/);
  assert.deepEqual(seen, ['main']);
});

test('other errors are not retried on the secondary key', async () => {
  process.env.ANTHROPIC_API_KEY_SECONDARY = 'second';
  const { anthropicClient, retryMainKey } = await import('../lib/anthropicClient');
  retryMainKey();
  const seen: string[] = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    seen.push(new Headers(init?.headers).get('x-api-key') || '');
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  await assert.rejects(ask(anthropicClient()), /too large/);
  assert.deepEqual(seen, ['main']);
});

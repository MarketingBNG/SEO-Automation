// Cost of Claude calls, from the usage each response returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

test('cost of a Claude Opus 5.5 call with web searches', async () => {
  const { costOf } = await import('../lib/aiCredits');
  // 100k in x $4 + 20k out x $20 + 50k cache read x $0.20 + 10k cache write x $5 = 0.4 + 0.4 + 0.01 + 0.05; 30 searches = $0.30
  const c = costOf('claude-opus-5-5', { input_tokens: 100000, output_tokens: 20000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 10000, server_tool_use: { web_search_requests: 30 } });
  assert.equal(Math.round(c * 10000) / 10000, 1.16);
  // Batch: tokens at half price, searches unchanged.
  const b = costOf('claude-opus-5-5', { input_tokens: 100000, output_tokens: 20000 }, { batch: true });
  assert.equal(Math.round(b * 10000) / 10000, 0.4);
});

test('Haiku 5.5: a prompt over 100K tokens is priced at the long-prompt rates', async () => {
  const { costOf } = await import('../lib/aiCredits');
  // Up to 100K: 100k in x $0.10 + 10k out x $0.50 = 0.01 + 0.005.
  assert.equal(Math.round(costOf('claude-haiku-5-5', { input_tokens: 100000, output_tokens: 10000 }) * 1e6) / 1e6, 0.015);
  // 60k in + 50k cache read = 110K prompt: 60k x $0.50 + 50k x $0.05 + 10k out x $2.50 = 0.03 + 0.0025 + 0.025.
  assert.equal(Math.round(costOf('claude-haiku-5-5', { input_tokens: 60000, cache_read_input_tokens: 50000, output_tokens: 10000 }) * 1e6) / 1e6, 0.0575);
});

test('the 401 message names the key the request used', async () => {
  const { friendlyApiError } = await import('../lib/apiErrors');
  assert.match(friendlyApiError({ status: 401, message: 'invalid x-api-key' }, 'main'), /Check ANTHROPIC_API_KEY in/);
  assert.match(friendlyApiError({ status: 401, message: 'invalid x-api-key' }, 'secondary'), /Check ANTHROPIC_API_KEY_SECONDARY in/);
});

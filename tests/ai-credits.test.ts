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

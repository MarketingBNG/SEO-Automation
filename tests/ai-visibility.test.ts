// Checks the SE Ranking AI visibility requests and parsing against stubbed API responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('AI visibility pulls ChatGPT, Perplexity, Gemini, AI Overviews and AI Mode from SE Ranking', async () => {
  process.env.SERANKING_API_KEY = 'test-key';
  const seen: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url));
    seen.push(u.pathname + u.search);
    assert.equal(init.headers.Authorization, 'Token test-key');
    if (u.pathname === '/v1/ai-search/overview/by-engine/time-series') {
      const n = { chatgpt: 4, perplexity: 3, gemini: 2, 'ai-overview': 6, 'ai-mode': 1 }[u.searchParams.get('engine')!]!;
      return Response.json({ summary: { link_presence: { current: n, previous: n - 1 }, average_position: { current: 3.2, previous: 4 }, ai_opportunity_traffic: { current: 10 } } });
    }
    if (u.pathname === '/v1/project-management/sites') return Response.json([{ id: 77 }]);
    if (u.pathname === '/v1/project-management/airt/llm') return Response.json([{ id: 1, base_name: 'ChatGPT' }, { id: 2, base_name: 'Perplexity' }]);
    if (u.pathname === '/v1/project-management/airt/llm/statistics') return Response.json({ brand_mentions_total: u.searchParams.get('llm_id') === '1' ? 12 : 5 });
    if (u.pathname === '/v1/project-management/airt/prompts/rankings') return Response.json({ groups: [{ mention_presence: 40, link_presence: 20 }] });
    return new Response('{}', { status: 404 });
  }) as any;

  const { gatherAiVisibility } = await import('../lib/aiVisibility');
  const r = await gatherAiVisibility('usaindiacfo.com', { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(r.errors, []);
  // 5 engines x 2 markets
  assert.equal(r.overview.length, 10);
  assert.ok(seen.some((s) => s.includes('engine=chatgpt') && s.includes('source=in') && s.includes('target=usaindiacfo.com')));
  // (4+3+2) x 2 markets
  assert.deepEqual(r.totals.chatLinks, { current: 18, previous: 12 });
  assert.deepEqual(r.totals.googleAiLinks, { current: 14, previous: 10 });
  assert.equal(r.totals.chatMentions, 17);
  assert.equal(r.tracker[0].mentionPresencePct, 40);
  assert.ok(seen.some((s) => s.startsWith('/v1/project-management/airt/llm/statistics?site_id=77&llm_id=1&from=2026-09-01')));
});

test('AI visibility reports failures as errors, never as numbers', async () => {
  globalThis.fetch = (async () => Response.json({ error_description: 'Plan does not include AI Search' }, { status: 403 })) as any;
  const { gatherAiVisibility } = await import('../lib/aiVisibility');
  const r = await gatherAiVisibility('usaindiacfo.com');
  assert.equal(r.totals.chatLinks.current, null);
  assert.equal(r.totals.chatMentions, null);
  assert.ok(r.errors.length > 0 && r.errors[0].includes('Plan does not include AI Search'));
});

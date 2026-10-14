// The edit token used by scripts/draft.ts reads drafts and edits their words, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const TOKEN = 'x'.repeat(40);

const req = (method: string, path: string, auth = `Bearer ${TOKEN}`) => new NextRequest(`https://seo.example${path}`, { method, headers: { authorization: auth } });

test('what the token may do', async () => {
  process.env.DRAFT_EDIT_TOKEN = TOKEN;
  const { draftTokenAllows, hasDraftToken } = await import('../lib/draftToken');
  assert.equal(hasDraftToken(req('GET', '/api/drafts/81')), true);
  assert.equal(hasDraftToken(req('GET', '/api/drafts/81', `Bearer ${'y'.repeat(40)}`)), false);
  assert.ok(draftTokenAllows('GET', '/api/drafts/list'));
  assert.ok(draftTokenAllows('PATCH', '/api/drafts/81'));
  assert.ok(draftTokenAllows('GET', '/api/drafts/81/download'));
  for (const [m, p] of [['DELETE', '/api/drafts/81'], ['POST', '/api/drafts/81/publish'], ['POST', '/api/drafts/81/word'], ['GET', '/api/settings'], ['POST', '/api/assistant/chat'], ['PATCH', '/api/drafts/81/x']]) {
    assert.equal(draftTokenAllows(m, p), false, `${m} ${p}`);
  }
  process.env.DRAFT_EDIT_TOKEN = 'short';
  assert.equal(hasDraftToken(req('GET', '/api/drafts/81', 'Bearer short')), false, 'a short token switches it off');
});

test('the proxy lets the token through only to draft reads and edits', async () => {
  process.env.DRAFT_EDIT_TOKEN = TOKEN;
  const { proxy } = await import('../proxy');
  const ok = await proxy(req('PATCH', '/api/drafts/81'));
  assert.equal(ok.headers.get('x-middleware-next'), '1');
  const denied = await proxy(req('POST', '/api/drafts/81/publish'));
  assert.equal(denied.status, 403);
  const page = await proxy(req('GET', '/'));
  assert.equal(page.status, 403);
});

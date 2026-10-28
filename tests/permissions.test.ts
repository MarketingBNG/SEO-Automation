// Role rules: what each of the four roles may do, checked the same way proxy.ts checks requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFor, can, canBlock, type Role } from '../lib/permissions';

const allowed = (role: Role, method: string, path: string) => {
  const a = actionFor(method, path);
  return a === null || can(role, a);
};

test('only the admin changes settings and AI credits', () => {
  assert.equal(allowed('admin', 'POST', '/api/settings'), true);
  for (const r of ['manager', 'analyst', 'user'] as Role[]) {
    assert.equal(allowed(r, 'POST', '/api/settings'), false, r);
    assert.equal(allowed(r, 'POST', '/api/ai-credits'), false, r);
  }
  assert.equal(allowed('analyst', 'GET', '/api/ai-credits'), true, 'analyst sees credits');
  assert.equal(allowed('user', 'GET', '/api/ai-credits'), false);
});

test('strategy: admin and manager approve; users only view', () => {
  assert.equal(allowed('manager', 'POST', '/api/strategy/5/approve'), true);
  assert.equal(allowed('analyst', 'POST', '/api/strategy/5/approve'), false);
  assert.equal(allowed('user', 'POST', '/api/strategy/5/approve'), false);
  assert.equal(allowed('user', 'PATCH', '/api/strategy/5'), false);
  assert.equal(allowed('user', 'GET', '/api/strategy/5'), true);
  assert.equal(allowed('manager', 'PATCH', '/api/strategy/5'), true);
});

test('reports: managers view but do not download; analysts download; users neither', () => {
  assert.equal(allowed('manager', 'GET', '/api/performance'), true);
  assert.equal(allowed('manager', 'GET', '/api/performance/download'), false);
  assert.equal(allowed('analyst', 'GET', '/api/performance/download'), true);
  assert.equal(allowed('analyst', 'GET', '/api/audit/3/download'), true);
  assert.equal(allowed('user', 'GET', '/api/performance'), false);
});

test('users ask the assistant and do manual tasks, nothing else', () => {
  assert.equal(allowed('user', 'POST', '/api/assistant/chat'), true);
  assert.equal(allowed('user', 'POST', '/api/assistant/decide'), false, 'cannot approve website changes');
  assert.equal(allowed('user', 'POST', '/api/strategy/manual'), true);
  assert.equal(allowed('user', 'POST', '/api/generate'), false);
  assert.equal(allowed('user', 'POST', '/api/keywords/add'), false);
  assert.equal(allowed('analyst', 'POST', '/api/generate'), true);
});

test('blocking: admin blocks anyone but the owner; managers block users and analysts', () => {
  assert.equal(canBlock('admin', 'manager', 'm@usaindiacfo.com'), true);
  assert.equal(canBlock('admin', 'admin', 'abhuday@usaindiacfo.com'), false);
  assert.equal(canBlock('manager', 'user', 'u@usaindiacfo.com'), true);
  assert.equal(canBlock('manager', 'analyst', 'a@usaindiacfo.com'), true);
  assert.equal(canBlock('manager', 'manager', 'm2@usaindiacfo.com'), false);
  assert.equal(canBlock('analyst', 'user', 'u@usaindiacfo.com'), false);
});

test('tester: everything except managing the team', () => {
  assert.equal(allowed('tester', 'POST', '/api/settings'), true);
  assert.equal(allowed('tester', 'POST', '/api/strategy/5/approve'), true);
  assert.equal(allowed('tester', 'GET', '/api/performance/download'), true);
  assert.equal(allowed('tester', 'GET', '/api/team'), false);
  assert.equal(canBlock('tester', 'user', 'u@usaindiacfo.com'), false);
  assert.equal(canBlock('admin', 'tester', 't@usaindiacfo.com'), true);
  assert.equal(canBlock('manager', 'tester', 't@usaindiacfo.com'), false);
});

test('settings route: only user-editable keys, never role access or Testing/Live mode', async () => {
  const { isEditableSetting } = await import('../lib/permissions');
  for (const k of ['voice_guidelines', 'max_words', 'service_ctas', 'tracked_keyword_target', 'byline_author']) assert.equal(isEditableSetting(k), true, k);
  for (const k of ['role_access', 'ai_mode', 'ai_paused', 'credit_balance_usd', 'apicache:x:y', 'scheduler_last_run', 'writer_lessons']) assert.equal(isEditableSetting(k), false, k);
});

test('reads that are not open to every role: meeting notes, OAuth connections, paid lookups', () => {
  assert.equal(allowed('user', 'GET', '/api/client-insights'), false);
  assert.equal(allowed('analyst', 'GET', '/api/client-insights'), true);
  assert.equal(allowed('user', 'GET', '/api/fireflies/transcripts'), false);
  assert.equal(allowed('analyst', 'GET', '/api/fireflies/test'), true, 'meetings page connection check');
  for (const p of ['/api/gbp/auth-url', '/api/gbp/oauth-callback', '/api/zoho/auth-url', '/api/zoho/oauth-callback', '/api/serphouse/check', '/api/pagespeed/check']) {
    assert.equal(allowed('manager', 'GET', p), false, p);
    assert.equal(allowed('admin', 'GET', p), true, p);
  }
  assert.equal(allowed('manager', 'GET', '/api/zoho/leads'), true);
});

test('the cron secret opens only the scheduled job routes, on GET', async () => {
  const { cronAllows, hasCronSecret } = await import('../lib/cronSecret');
  for (const p of ['/api/cron/daily', '/api/cron/sweep', '/api/skill/auto-check', '/api/strategy/auto-check/']) assert.equal(cronAllows('GET', p), true, p);
  assert.equal(cronAllows('POST', '/api/cron/daily'), false);
  for (const p of ['/api/settings', '/api/team', '/api/drafts/5/publish', '/api/cron/daily/x']) assert.equal(cronAllows('GET', p), false, p);
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'abc123';
  try {
    assert.equal(hasCronSecret(new Request('http://x/api/cron/daily', { headers: { authorization: 'Bearer abc123' } })), true);
    assert.equal(hasCronSecret(new Request('http://x/api/cron/daily', { headers: { authorization: 'Bearer abc124' } })), false);
    assert.equal(hasCronSecret(new Request('http://x/api/cron/daily')), false);
    process.env.CRON_SECRET = '';
    assert.equal(hasCronSecret(new Request('http://x/api/cron/daily', { headers: { authorization: 'Bearer ' } })), false);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});

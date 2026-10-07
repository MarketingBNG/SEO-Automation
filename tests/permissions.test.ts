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

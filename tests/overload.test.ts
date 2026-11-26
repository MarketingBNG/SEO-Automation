// The overload guard (lib/overload.ts): which requests are refused with 503 when the server is behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { installOverloadGuard, overloadState, shouldShed } from '../lib/overload';

const L = { targetMs: 5000, min: 64, max: 1500 };

test('reads are refused only when the recent answers are slow and many requests are open', () => {
  assert.equal(shouldShed('GET', '/api/drafts/list', { inflight: 10, avgMs: 9000 }, L), false);
  assert.equal(shouldShed('GET', '/api/drafts/list', { inflight: 200, avgMs: 900 }, L), false);
  assert.equal(shouldShed('GET', '/api/drafts/list', { inflight: 200, avgMs: 9000 }, L), true);
  assert.equal(shouldShed('GET', '/', { inflight: 1500, avgMs: 0 }, L), true);
  // An upload behind /api is not a public picture.
  assert.equal(shouldShed('GET', '/api/uploads/a.png', { inflight: 1500, avgMs: 0 }, L), true);
});

test('writes, sign-in, scheduled jobs, the website API and static files are never refused', () => {
  const busy = { inflight: 5000, avgMs: 60000 };
  for (const [m, u] of [['POST', '/api/strategy/schedule/3'], ['PATCH', '/api/drafts/1'], ['GET', '/api/auth/session'], ['GET', '/api/cron/sweep'], ['GET', '/api/site/v1/posts'], ['GET', '/_next/static/chunks/a.js'], ['GET', '/logo-icon-512.png'], ['GET', '/assistant/wave.webp']]) {
    assert.equal(shouldShed(m, u, busy, L), false, `${m} ${u}`);
  }
});

test('the installed guard counts open requests and answers 503 when over the cap', async () => {
  process.env.OVERLOAD_MAX_INFLIGHT = '2';
  process.env.OVERLOAD_HOLD_MS = '0';
  installOverloadGuard();
  const release: (() => void)[] = [];
  const server = http.createServer((_req, res) => release.push(() => res.end('ok')));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const get = () => new Promise<number>((ok) => http.get({ port, host: '127.0.0.1', path: '/api/status', agent: false }, (r) => (r.resume(), r.on('end', () => ok(r.statusCode!)))));
  const a = get();
  const b = get();
  while (overloadState()!.inflight < 2) await new Promise((r) => setTimeout(r, 5));
  assert.equal(await get(), 503);
  release.forEach((f) => f());
  assert.deepEqual([await a, await b], [200, 200]);
  server.close();
});

// lib/sharedRead.ts: one answer for many readers, never hiding a change made through the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dropSharedReads, noteRequest, sharedJson } from '../lib/sharedRead';

test('readers at the same moment share one computation, and the answer is reused within the time', async () => {
  let runs = 0;
  const compute = async () => (await new Promise((r) => setTimeout(r, 20)), { n: ++runs });
  const [a, b] = await Promise.all([sharedJson('t1', 1000, compute), sharedJson('t1', 1000, compute)]);
  assert.equal(a, '{"n":1}');
  assert.equal(b, a);
  assert.equal(await sharedJson('t1', 1000, compute), '{"n":1}');
  assert.equal(runs, 1);
});

test('a write (POST) or a cron job makes the next read fresh, also one that was being worked out', async () => {
  let runs = 0;
  const compute = async () => (await new Promise((r) => setTimeout(r, 20)), { n: ++runs });
  await sharedJson('t2', 60000, compute);
  const res = new EventEmitter() as any;
  noteRequest({ method: 'POST', url: '/api/strategy/schedule/1' } as any, res);
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":2}');
  res.emit('close');
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":3}');
  // A read that started before an action ended is not given to readers after it.
  const res2 = new EventEmitter() as any;
  noteRequest({ method: 'PATCH', url: '/api/drafts/1' } as any, res2);
  const before = sharedJson('t2', 60000, compute);
  res2.emit('close');
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":5}');
  assert.equal(await before, '{"n":4}');
  noteRequest({ method: 'GET', url: '/api/cron/sweep' } as any, new EventEmitter() as any);
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":6}');
  // A plain read changes nothing.
  noteRequest({ method: 'GET', url: '/api/home' } as any, new EventEmitter() as any);
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":6}');
  dropSharedReads();
  assert.equal(await sharedJson('t2', 60000, compute), '{"n":7}');
});

test('an answer older than the time is worked out again; a failure is not kept', async () => {
  let runs = 0;
  await sharedJson('t3', 1, async () => ++runs);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await sharedJson('t3', 1, async () => ++runs), '2');
  await assert.rejects(sharedJson('t4', 1000, async () => { throw new Error('db down'); }));
  assert.equal(await sharedJson('t4', 1000, async () => 'ok'), '"ok"');
});

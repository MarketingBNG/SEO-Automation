// Resumable runs (lib/aiReplay.ts): frozen prompt inputs and the pruning of saved steps.
// Needs a local database: DATABASE_URL=postgresql://... node --import tsx --test tests/ai-replay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = !!process.env.DATABASE_URL;

test('frozenInput: a later attempt of the same run reads the first value back', { skip: !db }, async () => {
  const { withReplay, frozenInput, clearReplay } = await import('../lib/aiReplay');
  const scope = `test-frozen-${Date.now()}`;
  let n = 0;
  const build = async () => ({ value: ++n });
  const first = await withReplay(scope, () => frozenInput('brief', build));
  const second = await withReplay(scope, () => frozenInput('brief', build));
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  // each: every read in the attempt is saved in order, so a value that changed between rounds keeps its own.
  const a = await withReplay(scope, async () => [await frozenInput('mem', build, { each: true }), await frozenInput('mem', build, { each: true })]);
  const b = await withReplay(scope, async () => [await frozenInput('mem', build, { each: true }), await frozenInput('mem', build, { each: true })]);
  assert.deepEqual(b, a);
  assert.notDeepEqual(a[0], a[1]);
  // Outside a run nothing is saved.
  assert.deepEqual(await frozenInput('brief', async () => 'live'), 'live');
  await clearReplay(scope);
});

test('pruneReplay keeps the old steps of a run still waiting to resume', { skip: !db }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { pruneReplay } = await import('../lib/aiReplay');
  const kw = await prisma.keywords.create({ data: { keyword: `prune test ${Date.now()}`, status: 'pending', error: 'AI work is paused' } });
  const old = '2000-01-01 00:00:00';
  await prisma.ai_replay.createMany({ data: [
    { scope: `blog-${kw.id}`, hash: 'h1', result: '{}', created_at: old },
    { scope: 'blog-999999999', hash: 'h1', result: '{}', created_at: old },
  ] });
  await pruneReplay();
  const left = await prisma.ai_replay.findMany({ where: { scope: { in: [`blog-${kw.id}`, 'blog-999999999'] } } });
  assert.deepEqual(left.map((r) => r.scope), [`blog-${kw.id}`]);
  await prisma.ai_replay.deleteMany({ where: { scope: `blog-${kw.id}` } });
  await prisma.keywords.delete({ where: { id: kw.id } });
});

test('frozenInput: a blog input saved days ago is built again; a strategy keeps its own', { skip: !db }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { withReplay, frozenInput, clearReplay } = await import('../lib/aiReplay');
  const blog = `blog-test-stale-${Date.now()}`;
  const strategy = `strategy-test-stale-${Date.now()}`;
  const old = '2000-01-01 00:00:00';
  await prisma.ai_replay.createMany({ data: [
    { scope: blog, hash: 'input:today', result: JSON.stringify({ run: 'x', value: '2000-01-01' }), created_at: old },
    { scope: strategy, hash: 'input:today', result: JSON.stringify({ run: 'x', value: '2000-01-01' }), created_at: old },
  ] });
  const build = async () => 'fresh';
  assert.equal(await withReplay(blog, () => frozenInput('today', build)), 'fresh');
  // Saved again with a new date, so the next attempt of the same run reads it back.
  assert.equal(await withReplay(blog, () => frozenInput('today', async () => 'other')), 'fresh');
  assert.equal(await withReplay(strategy, () => frozenInput('today', build)), '2000-01-01');
  await clearReplay(blog);
  await clearReplay(strategy);
});

test('pruneReplay keeps unwritten calendar blogs and their fact checks, not a blog a person stopped', { skip: !db }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { pruneReplay } = await import('../lib/aiReplay');
  const s = await prisma.seo_strategies.create({ data: { period: `test ${Date.now()}`, status: 'approved', plan_json: '{}' } });
  const row = await prisma.blog_schedule.create({ data: { strategy_id: s.id, publish_at: '2099-01-01 00:00:00', title: 't', main_keyword: `prune ${Date.now()}`, tags: '[]', status: 'planned', draft_id: 987654321 } });
  const stopped = await prisma.keywords.create({ data: { keyword: `stopped ${Date.now()}`, status: 'pending' } });
  const old = '2000-01-01 00:00:00';
  const scopes = [`blog-sched-${row.id}`, 'factcheck-987654321-abc', `blog-${stopped.id}`, 'factcheck-987654322-abc'];
  await prisma.ai_replay.createMany({ data: scopes.map((scope) => ({ scope, hash: 'h', result: '{}', created_at: old })) });
  await pruneReplay();
  const left = (await prisma.ai_replay.findMany({ where: { scope: { in: scopes } } })).map((r) => r.scope).sort();
  assert.deepEqual(left, [`blog-sched-${row.id}`, 'factcheck-987654321-abc'].sort());
  await prisma.ai_replay.deleteMany({ where: { scope: { in: scopes } } });
  await prisma.keywords.delete({ where: { id: stopped.id } });
  await prisma.blog_schedule.delete({ where: { id: row.id } });
  await prisma.seo_strategies.delete({ where: { id: s.id } });
});

test('a batch turn continued after pause_turn keeps its first part for a restart, so it is not paid again', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { callClaude } = await import('../lib/anthropic');
  const { runAutomatic, TestingModeError } = await import('../lib/aiQueue');
  const settings = await import('../lib/settings');
  const { CreditPausedError } = await import('../lib/aiCredits');
  const saved = { fetch: globalThis.fetch, key: process.env.ANTHROPIC_API_KEY, secondary: process.env.ANTHROPIC_API_KEY_SECONDARY, paused: await settings.get('ai_paused') };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_API_KEY_SECONDARY;
  const batches = new Map<string, any>();
  let creates = 0;
  let failPart1 = true;
  const msg = (text: string, stop: string) => ({ id: `msg_${text}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const batchJson = (id: string) => ({ id, type: 'message_batch', processing_status: 'ended', created_at: new Date().toISOString(), cancel_initiated_at: null, ended_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 }, results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results` });
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url instanceof Request ? url.url : url));
    if (u.hostname !== 'api.anthropic.com') throw new Error(`Network call in a test: ${u}`);
    const m = u.pathname.match(/^\/v1\/messages\/batches(?:\/([^/]+))?(\/results)?$/);
    if (!m) throw new Error(`Unexpected Anthropic call: ${u.pathname}`);
    const method = init?.method || 'GET';
    if (method === 'POST' && !m[1]) {
      const params = JSON.parse(init.body).requests[0].params;
      const part = params.messages.length === 1 ? 0 : 1;
      if (part === 1 && failPart1) return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 503 });
      creates++;
      const id = `msgbatch_test_${creates}_${Date.now()}`;
      batches.set(id, part === 0 ? msg('first part', 'pause_turn') : msg('second part', 'end_turn'));
      return Response.json(batchJson(id));
    }
    if (m[2]) return new Response(JSON.stringify({ custom_id: 'turn', result: { type: 'succeeded', message: batches.get(m[1]) } }) + '\n', { headers: { 'content-type': 'application/binary' } });
    return Response.json(batchJson(m[1]));
  }) as any;
  const ask = [{ role: 'user', content: `batch test ${Date.now()}` }];
  const feature = `test-batch-${Date.now()}`;
  const opts = { batch: true, maxUses: 1, feature };
  const usageRows = () => prisma.ai_usage.count({ where: { feature } });
  try {
    // The continuation cannot be sent (as if a restart cut it off): the first part's batch id stays.
    await assert.rejects(callClaude('system', ask, undefined, opts));
    assert.equal(creates, 1);
    assert.equal(await usageRows(), 1);
    // A transient error again: the first part is read again, its usage is not recorded twice.
    await assert.rejects(callClaude('system', ask, undefined, opts));
    assert.equal(await usageRows(), 1, 'a re-read part is not counted again');
    failPart1 = false;
    // Testing mode: the scheduler's run collects the part already paid for, and sends nothing new.
    (globalThis as any).__AI_MODE_PIN = 'testing';
    await assert.rejects(runAutomatic(() => callClaude('system', ask, undefined, opts)), (e: any) => e instanceof TestingModeError);
    await assert.rejects(runAutomatic(() => callClaude('system', ask, undefined, opts)), (e: any) => e instanceof TestingModeError);
    assert.equal(creates, 1, 'no new batch in Testing mode');
    assert.equal(await usageRows(), 1, 'collecting in Testing mode does not count the part again');
    (globalThis as any).__AI_MODE_PIN = 'live';
    // AI work paused: the first part is collected (free) but the continuation is not sent.
    await settings.set('ai_paused', '1');
    await assert.rejects(callClaude('system', ask, undefined, opts), (e: any) => e instanceof CreditPausedError);
    assert.equal(creates, 1, 'no paid part sent while AI work is paused');
    await settings.set('ai_paused', '0');
    const r: any = await callClaude('system', ask, undefined, opts);
    assert.equal(creates, 2, 'the first part is read from its batch again, only the second part is sent');
    assert.equal(await usageRows(), 2, 'each part counted once');
    assert.match(r.text, /first part[\s\S]*second part/);
    const left = await prisma.settings.count({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_' } } });
    assert.equal(left, 0, 'the saved ids are dropped once the whole call is done');
  } finally {
    globalThis.fetch = saved.fetch;
    (globalThis as any).__AI_MODE_PIN = 'live';
    await settings.set('ai_paused', saved.paused || '0');
    process.env.ANTHROPIC_API_KEY = saved.key || '';
    if (saved.secondary) process.env.ANTHROPIC_API_KEY_SECONDARY = saved.secondary;
    await prisma.settings.deleteMany({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_' } } });
    await prisma.ai_usage.deleteMany({ where: { feature } });
  }
});

test('a kept batch that is gone is not sent again while AI work is paused', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { callClaude } = await import('../lib/anthropic');
  const settings = await import('../lib/settings');
  const { CreditPausedError } = await import('../lib/aiCredits');
  const saved = { fetch: globalThis.fetch, key: process.env.ANTHROPIC_API_KEY, secondary: process.env.ANTHROPIC_API_KEY_SECONDARY, paused: await settings.get('ai_paused') };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_API_KEY_SECONDARY;
  const batches = new Map<string, any>();
  const gone = new Set<string>();
  let creates = 0;
  const msg = (text: string, stop: string) => ({ id: `msg_${text}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const batchJson = (id: string) => ({ id, type: 'message_batch', processing_status: 'ended', created_at: new Date().toISOString(), cancel_initiated_at: null, ended_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 }, results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results` });
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url instanceof Request ? url.url : url));
    if (u.hostname !== 'api.anthropic.com') throw new Error(`Network call in a test: ${u}`);
    const m = u.pathname.match(/^\/v1\/messages\/batches(?:\/([^/]+))?(\/results)?$/);
    if (!m) throw new Error(`Unexpected Anthropic call: ${u.pathname}`);
    const method = init?.method || 'GET';
    if (method === 'POST' && !m[1]) {
      const params = JSON.parse(init.body).requests[0].params;
      // The continuation fails (as if a restart cut it off), so the first part's id is kept.
      if (params.messages.length > 1) return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 503 });
      creates++;
      const id = `msgbatch_test_gone_${creates}_${Date.now()}`;
      batches.set(id, msg('first part', 'pause_turn'));
      return Response.json(batchJson(id));
    }
    if (gone.has(m[1])) return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }, { status: 404 });
    if (m[2]) return new Response(JSON.stringify({ custom_id: 'turn', result: { type: 'succeeded', message: batches.get(m[1]) } }) + '\n', { headers: { 'content-type': 'application/binary' } });
    return Response.json(batchJson(m[1]));
  }) as any;
  const ask = [{ role: 'user', content: `batch gone test ${Date.now()}` }];
  const feature = `test-batch-gone-${Date.now()}`;
  const opts = { batch: true, maxUses: 1, feature };
  try {
    await assert.rejects(callClaude('system', ask, undefined, opts));
    assert.equal(creates, 1);
    // The kept batch can no longer be read (cancelled, too old, or not reachable with this key).
    for (const id of batches.keys()) gone.add(id);
    await settings.set('ai_paused', '1');
    await assert.rejects(callClaude('system', ask, undefined, opts), (e: any) => e instanceof CreditPausedError);
    assert.equal(creates, 1, 'no new paid batch while AI work is paused');
  } finally {
    globalThis.fetch = saved.fetch;
    await settings.set('ai_paused', saved.paused || '0');
    process.env.ANTHROPIC_API_KEY = saved.key || '';
    if (saved.secondary) process.env.ANTHROPIC_API_KEY_SECONDARY = saved.secondary;
    await prisma.settings.deleteMany({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_gone_' } } });
    await prisma.ai_usage.deleteMany({ where: { feature } });
  }
});

test('a kept batch is read with the key that sent it, so it is not paid again after a switch to the secondary key', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { callClaude } = await import('../lib/anthropic');
  const { switchedToSecondary, retryMainKey, keyInUse } = await import('../lib/anthropicClient');
  const saved = { fetch: globalThis.fetch, key: process.env.ANTHROPIC_API_KEY, secondary: process.env.ANTHROPIC_API_KEY_SECONDARY, slack: process.env.SLACK_WEBHOOK_URL };
  process.env.ANTHROPIC_API_KEY = 'test-main-key';
  process.env.ANTHROPIC_API_KEY_SECONDARY = 'test-secondary-key';
  delete process.env.SLACK_WEBHOOK_URL;
  retryMainKey();
  // Batches belong to the account of the key that made them: the other key gets a 404.
  const batches = new Map<string, { owner: string; message: any }>();
  const created: string[] = [];
  let failPart1 = true;
  const msg = (text: string, stop: string) => ({ id: `msg_${text}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const batchJson = (id: string) => ({ id, type: 'message_batch', processing_status: 'ended', created_at: new Date().toISOString(), cancel_initiated_at: null, ended_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 }, results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results` });
  globalThis.fetch = (async (url: any, init: any) => {
    const u = new URL(String(url instanceof Request ? url.url : url));
    if (u.hostname !== 'api.anthropic.com') throw new Error(`Network call in a test: ${u}`);
    const m = u.pathname.match(/^\/v1\/messages\/batches(?:\/([^/]+))?(\/results)?$/);
    if (!m) throw new Error(`Unexpected Anthropic call: ${u.pathname}`);
    const key = new Headers(init?.headers).get('x-api-key') || '';
    const method = init?.method || 'GET';
    if (method === 'POST' && !m[1]) {
      const params = JSON.parse(init.body).requests[0].params;
      const part = params.messages.length === 1 ? 0 : 1;
      if (part === 1 && failPart1) return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 503 });
      const id = `msgbatch_test_keys_${created.length}_${Date.now()}`;
      created.push(`${part}:${key}`);
      batches.set(id, { owner: key, message: part === 0 ? msg('first part', 'pause_turn') : msg('second part', 'end_turn') });
      return Response.json(batchJson(id));
    }
    const b = batches.get(m[1]);
    if (!b || b.owner !== key) return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }, { status: 404 });
    if (m[2]) return new Response(JSON.stringify({ custom_id: 'turn', result: { type: 'succeeded', message: b.message } }) + '\n', { headers: { 'content-type': 'application/binary' } });
    return Response.json(batchJson(m[1]));
  }) as any;
  const ask = [{ role: 'user', content: `batch keys test ${Date.now()}` }];
  const feature = `test-batch-keys-${Date.now()}`;
  const opts = { batch: true, maxUses: 1, feature };
  try {
    // Part 0 is sent and paid on the main key; the continuation hits a passing error, so it is kept.
    await assert.rejects(callClaude('system', ask, undefined, opts));
    assert.deepEqual(created, ['0:test-main-key']);
    const kept = await prisma.settings.findFirst({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_keys_' } } });
    assert.equal(JSON.parse(kept!.value!).key, 'main', 'the key that sent the batch is saved with it');
    // The main key ran out of credit: new requests use the secondary key for an hour.
    switchedToSecondary();
    assert.equal(keyInUse(), 'secondary');
    failPart1 = false;
    const r: any = await callClaude('system', ask, undefined, opts);
    assert.deepEqual(created, ['0:test-main-key', '1:test-secondary-key'], 'part 0 is read on the main key, not sent again on the secondary one');
    assert.match(r.text, /first part[\s\S]*second part/);

    // An id saved before the key was recorded: this client's key, then the other one.
    failPart1 = true;
    const ask2 = [{ role: 'user', content: `batch keys legacy test ${Date.now()}` }];
    retryMainKey();
    await assert.rejects(callClaude('system', ask2, undefined, opts));
    const k2 = await prisma.settings.findFirst({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_keys_' } } });
    await prisma.settings.update({ where: { key: k2!.key }, data: { value: JSON.stringify({ id: JSON.parse(k2!.value!).id, at: Date.now() }) } });
    switchedToSecondary();
    failPart1 = false;
    await callClaude('system', ask2, undefined, opts);
    assert.equal(created.filter((c) => c.startsWith('0:')).length, 2, 'the legacy kept part is found on the other key, not paid again');
  } finally {
    globalThis.fetch = saved.fetch;
    retryMainKey();
    process.env.ANTHROPIC_API_KEY = saved.key || '';
    if (saved.secondary) process.env.ANTHROPIC_API_KEY_SECONDARY = saved.secondary;
    else delete process.env.ANTHROPIC_API_KEY_SECONDARY;
    if (saved.slack) process.env.SLACK_WEBHOOK_URL = saved.slack;
    await prisma.settings.deleteMany({ where: { key: { startsWith: 'batch_pending:' }, value: { contains: 'msgbatch_test_keys_' } } });
    await prisma.ai_usage.deleteMany({ where: { feature } });
  }
});

test('tests run in Live mode even when the database is left in Testing mode', { skip: !db, timeout: 60000 }, async () => {
  const settings = await import('../lib/settings');
  const { aiMode, setAiMode } = await import('../lib/aiQueue');
  const before = await settings.get('ai_mode');
  try {
    await setAiMode('testing');
    // Pinned by tests/setup.ts: a test's AI request never waits in the Claude Code queue.
    assert.equal(await aiMode(), 'live');
  } finally {
    await settings.set('ai_mode', before === 'testing' ? 'testing' : 'live');
  }
});

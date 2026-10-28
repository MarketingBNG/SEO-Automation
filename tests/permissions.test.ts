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

test('only settings.change connects Zoho or Google Business Profile', () => {
  for (const path of ['/api/zoho/auth-url', '/api/zoho/oauth-callback', '/api/gbp/auth-url', '/api/gbp/oauth-callback']) {
    assert.equal(actionFor('GET', path), 'settings.change', path);
    for (const r of ['manager', 'analyst', 'user'] as Role[]) assert.equal(allowed(r, 'GET', path), false, `${r} ${path}`);
    assert.equal(allowed('admin', 'GET', path), true);
  }
});

test('a private assistant document cannot be read through a key that storage would rewrite', { skip: !!process.env.BLOB_READ_WRITE_TOKEN }, async () => {
  const { GET } = await import('../app/api/uploads/[...file]/route');
  const { saveFile, deleteFile } = await import('../lib/storage');
  // A real file on local disk, so a key that slipped past the owner check would be served (200).
  const name = `test-${Date.now()}-a.pdf`;
  await saveFile(`assistant/docs/${name}`, Buffer.from('private'));
  try {
    for (const file of [['x', 'uploads', 'assistant', 'docs', name], [`assistant\\docs\\${name}`], ['assistant', `docs\\${name}`]]) {
      const res = await GET(new Request('http://localhost/api/uploads/x'), { params: Promise.resolve({ file }) });
      assert.equal(res.status, 404, file.join('/'));
    }
  } finally {
    await deleteFile(`assistant/docs/${name}`);
  }
});

test('assistant chats and files: owned by email; a shared display name opens only rows from before', async () => {
  const { isOwner, ownedBy, mineOnly } = await import('../lib/assistant/conversations');
  const a = { email: 'rahul.a@example.com', name: 'Rahul Sharma', role: 'user' };
  const b = { email: 'rahul.b@example.com', name: 'Rahul Sharma', role: 'user' };
  assert.equal(isOwner(a, a.email), true);
  assert.equal(isOwner(b, a.email), false, 'the same name does not open a newer row');
  assert.equal(isOwner(a, 'Rahul Sharma'), true, 'a row from before (display name) still opens');
  assert.equal(isOwner(a, null), false);
  assert.deepEqual(ownedBy(b, 'uploaded_by'), { OR: [{ uploaded_by: b.email }, { uploaded_by: 'Rahul Sharma' }] });
  assert.deepEqual(ownedBy({ email: 'x@example.com', name: 'x@example.com' }, 'created_by'), { OR: [{ created_by: 'x@example.com' }] });
  assert.equal(mineOnly({ ...a, role: 'admin' }), null);
});

test('an image attached in a private assistant chat is read and sent to Claude only by its uploader or the admin', { skip: !process.env.DATABASE_URL }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { canReadAssistantFile, ownImageIds } = await import('../lib/assistant/fileAccess');
  const stamp = Date.now();
  const path = `assistant/${stamp}-secret.png`;
  const model = `assistant/${stamp}-model.jpg`;
  const legacy = `assistant/${stamp}-old.png`;
  const a = { email: 'owner-a@example.com', name: 'Owner A', role: 'manager' };
  const b = { email: 'member-b@example.com', name: 'Member B', role: 'user' };
  const admin = { email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const img = await prisma.image_library.create({ data: { filename: 'secret.png', path, model_path: model } });
  const old = await prisma.image_library.create({ data: { filename: 'old.png', path: legacy } });
  const file = await prisma.assistant_files.create({ data: { kind: 'image', filename: 'secret.png', path, mime: 'image/png', size: 1, uploaded_by: a.email } });
  try {
    for (const key of [path, model]) {
      assert.equal(await canReadAssistantFile(a, key), true, key);
      assert.equal(await canReadAssistantFile(admin, key), true, key);
      assert.equal(await canReadAssistantFile(b, key), false, key);
      assert.equal(await canReadAssistantFile(null, key), false, key);
    }
    assert.equal(await canReadAssistantFile(b, legacy), true, 'attached before files were recorded: served as before');
    assert.equal(await canReadAssistantFile(b, `assistant/docs/${stamp}-none.pdf`), false, 'a document needs its owner');
    assert.deepEqual(await ownImageIds(a, [img.id]), [img.id]);
    assert.deepEqual(await ownImageIds(b, [img.id, old.id]), [], "someone else's image (or one with no owner) is not sent");
    assert.deepEqual(await ownImageIds(admin, [img.id]), [img.id]);
  } finally {
    await prisma.assistant_files.delete({ where: { id: file.id } });
    await prisma.image_library.deleteMany({ where: { id: { in: [img.id, old.id] } } });
  }
});

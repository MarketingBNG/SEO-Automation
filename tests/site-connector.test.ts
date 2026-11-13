// The dashboard reaches the website only through its connector (lib/site.ts, lib/siteConnector.ts).
// Without SITE_CONNECTOR_URL / SITE_CONNECTOR_SECRET every website action fails with one clear
// message, is logged, and a calendar blog is held (not failed). With them, every call is a signed
// request to the connector, answered here by a small in-memory website. Nothing reaches an outside
// service. Database tests use DATABASE_URL (local test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const db = Boolean(process.env.DATABASE_URL);
const NOT_SET_UP = 'The website connection is not set up. Add SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET in Coolify.';
const CONNECTOR = 'https://site.test/_bridge/dashboard-connector.php';
const SECRET = 'connector-test-secret';
const ON = { SITE_CONNECTOR_URL: CONNECTOR, SITE_CONNECTOR_SECRET: SECRET };

// ---- The fake website (the connector's actions as the site's developer described them) ----
type FakePost = Record<string, any>;
const site = new Map<string, FakePost>();
let nextId = 1;
const calls: { action: string; data: any }[] = [];
const outside: string[] = [];
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u !== CONNECTOR) {
    outside.push(u);
    throw new Error(`Network call in a test: ${u}`);
  }
  const body = String(init?.body || '');
  const ts = init?.headers?.['X-Dashboard-Timestamp'];
  const sig = init?.headers?.['X-Dashboard-Signature'];
  const reply = (status: number, json: any) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (sig !== crypto.createHmac('sha256', SECRET).update(`${ts}\n${body}`).digest('hex')) return reply(401, { ok: false, error: 'bad signature' });
  const { action, data, nonce } = JSON.parse(body);
  if (!nonce) return reply(400, { ok: false, error: 'no nonce' });
  calls.push({ action, data });
  const now = '2026-11-10 10:00:00';
  switch (action) {
    case 'ping':
      return reply(200, { ok: true, site: 'site.test', storage: 'disk' });
    case 'post.list':
      // The list leaves the article text out: the dashboard reads each post when it needs the text.
      return reply(200, { ok: true, posts: [...site.values()].map(({ content, ...p }) => p) });
    case 'post.get': {
      const p = site.get(data.slug);
      return p ? reply(200, { ok: true, post: p }) : reply(404, { ok: false, error: 'not found' });
    }
    case 'post.create':
      if (site.has(data.slug)) return reply(409, { ok: false, error: 'slug taken' });
      site.set(data.slug, { ...data, id: nextId++, url: `/insights/${data.slug}/`, published_at: now, updated_at: now });
      return reply(200, { ok: true });
    case 'post.update': {
      const p = site.get(data.slug);
      if (!p) return reply(404, { ok: false, error: 'not found' });
      site.set(data.slug, { ...p, ...data, updated_at: now });
      return reply(200, { ok: true });
    }
    case 'media.upload':
      return reply(200, { ok: true, url: `/uploads/2026/11/${data.filename}` });
    default:
      return reply(400, { ok: false, error: `unknown action ${action}` });
  }
}) as any;

const ENV_KEYS = ['SITE_URL', 'WORDPRESS_SITE_URL', 'SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET', 'SITE_CONNECTOR_DRAFTS'];
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

test('without the website connection every website action fails with one clear message and calls nothing', async () => {
  const s = await import('../lib/site');
  calls.length = 0;
  outside.length = 0;
  await withEnv({ SITE_URL: 'https://site.test' }, async () => {
    assert.equal(s.siteConfigured(), false);
    const actions: [string, () => Promise<unknown>][] = [
      ['test', () => s.testConnection()],
      ['publish', () => s.publishPost({ title: 'A blog', contentHtml: '<p>x</p>' })],
      ['update', () => s.updatePost(1_000_000_001, { contentHtml: '<p>x</p>' })],
      ['list', () => s.listPosts()],
      ['live posts', () => s.livePosts({ full: true })],
      ['search', () => s.searchPosts('itin guide')],
      ['read', () => s.getPost(1_000_000_001)],
      ['by address', () => s.findPostByUrl('https://site.test/insights/a/')],
      ['image', () => s.uploadImage('covers/none.png')],
      ['address check', () => s.freeSlug('a-blog')],
    ];
    for (const [name, run] of actions) {
      await assert.rejects(run(), (e: any) => e.message === NOT_SET_UP && e.status === 503, name);
    }
    // Planned technical fixes wait instead of being marked failed.
    const { runFixes } = await import('../lib/strategy/fixer');
    assert.equal((await runFixes()).skipped, NOT_SET_UP);
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(outside, [], 'nothing was sent anywhere');
});

test('Settings > Website connection: not set up, then a signed ping that shows the site and drafts', async () => {
  const { GET } = await import('../app/api/site/test/route');
  await withEnv({}, async () => {
    const j = await (await GET()).json();
    assert.deepEqual(j, { ok: false, connected: false, error: NOT_SET_UP });
  });
  await withEnv(ON, async () => {
    const j = await (await GET()).json();
    assert.equal(j.ok, true);
    assert.equal(j.site, 'site.test');
    assert.equal(j.draftsAllowed, false);
  });
  await withEnv({ ...ON, SITE_CONNECTOR_DRAFTS: 'on' }, async () => {
    assert.equal((await (await GET()).json()).draftsAllowed, true);
  });
  // A wrong secret is refused by the website and reported.
  await withEnv({ ...ON, SITE_CONNECTOR_SECRET: 'wrong' }, async () => {
    const res = await GET();
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /bad signature/);
  });
  // The live post list says the same when the connection is missing.
  const posts = await import('../app/api/site/posts/route');
  await withEnv({}, async () => {
    const { NextRequest } = await import('next/server');
    const j = await (await posts.GET(new NextRequest('http://x/api/site/posts'))).json();
    assert.equal(j.connected, false);
    assert.equal(j.error, NOT_SET_UP);
  });
});

test('publishing, updating, listing and reading go through the signed connector only', async () => {
  const s = await import('../lib/site');
  site.clear();
  calls.length = 0;
  outside.length = 0;
  await withEnv(ON, async () => {
    const post = await s.publishPost({
      title: 'How to apply for an ITIN',
      contentHtml: '<h2>Steps</h2><p>Text.</p>',
      excerpt: 'Short meta',
      metaDescription: 'Short meta',
      focusKeyphrase: 'itin application',
      featuredImageUrl: 'https://site.test/uploads/2026/11/cover.png',
      featuredImageAlt: 'ITIN cover',
      authorName: 'Harsh Jain, CA',
      slug: 'itin-application',
    });
    const created = calls.find((c) => c.action === 'post.create')!.data;
    assert.equal(created.slug, 'itin-application');
    assert.equal(created.status, 'published');
    assert.equal(created.author, 'harsh-jain');
    assert.equal(created.seo_description, 'Short meta');
    assert.equal(created.focus_keyphrase, 'itin application');
    assert.equal(created.featured_image, 'https://site.test/uploads/2026/11/cover.png');
    assert.equal(created.featured_image_alt, 'ITIN cover');
    assert.equal(post.status, 'publish');
    assert.equal(post.link, 'https://site.test/insights/itin-application/');
    assert.ok(post.id! > 1_000_000_000, 'the dashboard id is the site id moved up');

    // The same address again: the live post is reported and the new one gets -2 (never overwritten).
    assert.deepEqual((await s.freeSlug('itin-application')).liveHolder, { id: post.id, link: post.link });
    assert.equal((await s.freeSlug('itin-application', post.id)).liveHolder, null, 'its own post is not a holder');
    const second = await s.publishPost({ title: 'Another ITIN post', contentHtml: '<p>B</p>', slug: 'itin-application' });
    assert.equal(second.slug, 'itin-application-2');

    // An update changes only what it is given; the rest is sent as it is.
    await s.updatePost(post.id!, { seoTitle: 'ITIN application guide' });
    const updated = site.get('itin-application')!;
    assert.equal(updated.seo_title, 'ITIN application guide');
    assert.equal(updated.content, '<h2>Steps</h2><p>Text.</p>');
    assert.equal(updated.seo_description, 'Short meta');
    assert.equal(updated.author, 'harsh-jain');
    assert.equal(updated.featured_image, 'https://site.test/uploads/2026/11/cover.png');
    assert.equal(updated.status, 'published');

    // Reads: one post, by address, the paged list and the full text of every live post.
    assert.equal((await s.getPost(post.id!)).content, '<h2>Steps</h2><p>Text.</p>');
    assert.equal((await s.findPostByUrl('https://site.test/insights/itin-application-2/')).title, 'Another ITIN post');
    assert.equal(await s.postStatus(post.id!), 'publish');
    assert.equal(await s.postStatus(1_000_999_999), null, 'not on the website');
    const page = await s.listPosts({ perPage: 1, page: 2 });
    assert.equal(page.totalPages, 2);
    assert.equal(page.posts.length, 1);
    const full = await s.livePosts({ full: true, fresh: true });
    assert.deepEqual(full.map((p) => p.content).sort(), ['<h2>Steps</h2><p>Text.</p>', '<p>B</p>'].sort(), 'text read post by post');
    assert.equal((await s.searchPosts('itin', 5)).length, 2);

    // An id saved before the move to the custom website is never sent to the website.
    await assert.rejects(s.updatePost(42, { contentHtml: '<p>x</p>' }), /old website/);
    // Drafts stay refused until the website keeps them hidden.
    const before = calls.length;
    await assert.rejects(s.publishPost({ title: 'A draft', contentHtml: '<p>x</p>', status: 'draft' }), /switched off/);
    assert.equal(calls.filter((c) => c.action === 'post.create').length, calls.slice(0, before).filter((c) => c.action === 'post.create').length);
  });
  assert.ok(calls.every((c) => ['post.create', 'post.get', 'post.list', 'post.update'].includes(c.action)));
  assert.deepEqual(outside, [], 'no request went anywhere but the connector');
});

test('images are uploaded to the website through the connector', { skip: !db, timeout: 60000 }, async () => {
  const { saveFile, deleteFile } = await import('../lib/storage');
  const s = await import('../lib/site');
  const key = `test/site-connector-${Date.now()}.png`;
  await saveFile(key, Buffer.from('fake png bytes'), 'image/png');
  calls.length = 0;
  try {
    await withEnv(ON, async () => {
      const img = await s.uploadImage(key, { altText: 'A chart' });
      assert.match(img.url, /^https:\/\/site\.test\/uploads\/2026\/11\/site-connector-\d+\.png$/);
      assert.ok(img.id > 0);
      assert.equal(img.altText, 'A chart');
      const sent = calls.find((c) => c.action === 'media.upload')!.data;
      assert.equal(Buffer.from(sent.base64, 'base64').toString(), 'fake png bytes');
    });
  } finally {
    await deleteFile(key);
  }
});

test('a calendar blog is held (not failed) while the website connection is missing', { skip: !db, timeout: 60000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { publishScheduleNow } = await import('../lib/strategy/autopilot');
  const stamp = Date.now();
  const s = await prisma.seo_strategies.create({ data: { period: `site test ${stamp}`, status: 'superseded', plan_json: '{}' } });
  const kw = await prisma.keywords.create({ data: { keyword: `office plants ${stamp}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Office plants that need little care', meta_description: 'Meta', content_html: '<p>Plain text.</p>', status: 'approved' } });
  const row = await prisma.blog_schedule.create({ data: { strategy_id: s.id, publish_at: '2000-01-01 00:00:00', title: draft.title!, tags: '[]', main_keyword: kw.keyword, status: 'in_review', draft_id: draft.id, reviewed_at: '2000-01-01 00:00:00' } });
  calls.length = 0;
  try {
    for (let run = 0; run < 2; run++) {
      const r: any = await withEnv({}, () => publishScheduleNow(row.id));
      assert.equal(r.result, 'held', `run ${run + 1}`);
      assert.ok(r.hold_reasons.includes(NOT_SET_UP), `run ${run + 1}: ${r.hold_reasons}`);
      const after = (await prisma.blog_schedule.findUnique({ where: { id: row.id } }))!;
      assert.equal(after.status, 'held');
    }
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } }))!.status, 'approved', 'nothing was published');
    assert.deepEqual(calls, []);
  } finally {
    await prisma.blog_schedule.deleteMany({ where: { id: row.id } });
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: s.id } });
  }
});

test('Check a blog: publishing a rewrite without the website connection is refused, logged, and changes nothing', { skip: !db, timeout: 60000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { POST } = await import('../app/api/audit/[id]/publish/route');
  const audit = await prisma.blog_audits.create({ data: { title: 'Audit test', rewrite_title: 'Rewrite test', rewrite_content_html: '<p>Rewritten.</p>', rewrite_meta: 'Meta' } as any });
  try {
    const res: any = await withEnv({}, () => POST(new Request(`http://x/api/audit/${audit.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'publish' }) }) as any, { params: Promise.resolve({ id: String(audit.id) }) }));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, NOT_SET_UP);
    const logged = await prisma.activity_log.findFirst({ where: { action: 'audit.rewrite_publish_failed', entity_id: audit.id }, orderBy: { id: 'desc' } });
    assert.match(String(logged?.details), /website connection is not set up/);
    assert.equal((await prisma.blog_audits.findUnique({ where: { id: audit.id } }))!.rewrite_status, audit.rewrite_status);
    // A website draft is refused while the website makes every saved post live.
    const draft: any = await withEnv(ON, () => POST(new Request(`http://x/api/audit/${audit.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'draft' }) }) as any, { params: Promise.resolve({ id: String(audit.id) }) }));
    assert.equal(draft.status, 400);
    assert.match((await draft.json()).error, /switched off/);
  } finally {
    await prisma.blog_audits.deleteMany({ where: { id: audit.id } });
  }
});

test('Drafts & Review: an approved blog is published to the website through the connector', { skip: !db, timeout: 120000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const stamp = Date.now();
  const kw = await prisma.keywords.create({ data: { keyword: `office plants care ${stamp}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Office plants that need little care', meta_description: 'Which office plants need little care.', content_html: '<h2>Easy plants</h2><p>Plain text.</p>', status: 'approved', author: 'Naman Gangwal' } });
  site.clear();
  calls.length = 0;
  try {
    const res: any = await withEnv(ON, () => POST(new Request(`http://x/api/drafts/${draft.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'publish' }) }) as any, { params: Promise.resolve({ id: String(draft.id) }) }));
    const j = await res.json();
    assert.equal(res.status, 200, JSON.stringify(j));
    assert.equal(j.check.live, true);
    assert.match(j.wpPostUrl, /^https:\/\/site\.test\/insights\/office-plants-care-\d+\/$/);
    const created = calls.find((c) => c.action === 'post.create')!.data;
    assert.equal(created.author, 'naman-gangwal');
    assert.equal(created.seo_description, 'Which office plants need little care.');
    assert.match(String(created.featured_image), /^https:\/\/site\.test\/uploads\//, 'the cover went up through the connector');
    const after = (await prisma.drafts.findUnique({ where: { id: draft.id } }))!;
    assert.equal(after.status, 'published');
    assert.equal(after.wp_post_url, j.wpPostUrl);
    assert.ok(after.wp_post_id! > 1_000_000_000);
    assert.ok(await prisma.activity_log.findFirst({ where: { action: 'site.published', entity_id: draft.id } }));
  } finally {
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

test('Drafts & Review: a blog published before the move is updated on the website by its address, not copied', { skip: !db, timeout: 120000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const stamp = Date.now();
  site.clear();
  site.set('older-guide', { id: 7, slug: 'older-guide', title: 'Older guide', content: '<p>Old text.</p>', excerpt: '', status: 'published', url: '/insights/older-guide/', author: 'amit-agarwal' });
  const kw = await prisma.keywords.create({ data: { keyword: `older guide ${stamp}`, status: 'done' } });
  // wp_post_id 42 is an id from the old website; the address is the post's address on the new one.
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Older guide', meta_description: 'Updated meta.', content_html: '<h2>New</h2><p>New text.</p>', status: 'published', wp_post_id: 42, wp_post_url: 'https://site.test/insights/older-guide/', author: 'Amit Agarwal' } });
  calls.length = 0;
  try {
    const res: any = await withEnv(ON, () => POST(new Request(`http://x/api/drafts/${draft.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'publish' }) }) as any, { params: Promise.resolve({ id: String(draft.id) }) }));
    const j = await res.json();
    assert.equal(res.status, 200, JSON.stringify(j));
    assert.equal(calls.filter((c) => c.action === 'post.create').length, 0, 'no copy made');
    assert.equal(calls.filter((c) => c.action === 'post.update').length, 1);
    assert.match(site.get('older-guide')!.content, /New text/);
    assert.equal(j.wpPostUrl, 'https://site.test/insights/older-guide/');
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } }))!.wp_post_id, 1_000_000_007, 'the website id is kept from now on');
  } finally {
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

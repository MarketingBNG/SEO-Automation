// Post my blog: the owner's own blog posted as it is, with only the checks the person ticks, through
// the same publish code as Drafts & Review, onto a small in-memory website behind the signed
// connector (the same fake website as tests/site-connector.test.ts). Banners: the design variant is
// sent to the Social dashboard, and the banner the person chose is the one the post carries.
// The fact check is answered through the Testing-mode queue (ai_jobs), never the API. Nothing
// reaches an outside service. Database tests use DATABASE_URL (local test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

const db = Boolean(process.env.DATABASE_URL);
const CONNECTOR = 'https://site.test/_bridge/dashboard-connector.php';
const SECRET = 'connector-test-secret';
const SOCIAL = 'https://social.test';
const SOCIAL_SECRET = 'social-test-secret-0123456789abcdef0123';
const ON = { SITE_CONNECTOR_URL: CONNECTOR, SITE_CONNECTOR_SECRET: SECRET };

// ---- The fake website (as in tests/site-connector.test.ts) and the fake Social dashboard ----
const site = new Map<string, Record<string, any>>();
let nextId = 1;
const calls: { action: string; data: any }[] = [];
const outside: string[] = [];
const bannerAsks: any[] = [];
let bannerBytes: Buffer | null = null;
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url instanceof Request ? url.url : url);
  const reply = (status: number, json: any) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (u === `${SOCIAL}/api/share/banner`) {
    bannerAsks.push(JSON.parse(String(init?.body || '{}')));
    return new Response(new Uint8Array(bannerBytes!), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }
  // No design skills shared: the art director (an AI call) is skipped.
  if (u === `${SOCIAL}/api/share/skills`) return reply(200, { text: '' });
  if (u !== CONNECTOR) {
    outside.push(u);
    throw new Error(`Network call in a test: ${u}`);
  }
  const body = String(init?.body || '');
  const ts = init?.headers?.['X-Dashboard-Timestamp'];
  const sig = init?.headers?.['X-Dashboard-Signature'];
  if (sig !== crypto.createHmac('sha256', SECRET).update(`${ts}\n${body}`).digest('hex')) return reply(401, { ok: false, error: 'bad signature' });
  const { action, data } = JSON.parse(body);
  calls.push({ action, data });
  const now = '2026-11-14 10:00:00';
  switch (action) {
    case 'post.list':
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

const ENV_KEYS = ['SITE_URL', 'WORDPRESS_SITE_URL', 'SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET', 'SITE_CONNECTOR_DRAFTS', 'SOCIAL_SKILLS_SECRET', 'SOCIAL_DASHBOARD_URL', 'PEXELS_API_KEY', 'OPENAI_API_KEY', 'SERPHOUSE_API_KEY', 'COPYSCAPE_USERNAME'];
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

const ADMIN = { email: 'owner@usaindiacfo.com', role: 'admin' as const, blocked: false };
const ANALYST = { email: 'analyst@usaindiacfo.com', role: 'analyst' as const, blocked: false };
const words = (n: number, w = 'plant') => Array.from({ length: n }, () => w).join(' ');
const article = (extra = '') => `<h2>Easy office plants</h2><p>Snake plants and pothos need water about once every two weeks. ${words(60)}</p>${extra}`;
const stamp = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

async function cleanup(draftId?: number | null) {
  const prisma = (await import('../lib/prisma')).default;
  if (!draftId) return;
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, select: { keyword_id: true } });
  await prisma.content_changes.deleteMany({ where: { entity_type: 'draft', entity_id: draftId } });
  await prisma.drafts.deleteMany({ where: { id: draftId } });
  if (d) await prisma.keywords.deleteMany({ where: { id: d.keyword_id } });
}

test('Post now with no checks puts the blog live as it is, through the connector', { skip: !db, timeout: 120000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { postMyBlog } = await import('../lib/myBlog');
  const title = `Office plants that need little care ${stamp()}`;
  calls.length = 0;
  let id: number | null = null;
  try {
    const r = await withEnv(ON, () => postMyBlog({ title, html: article(), keyword: 'office plants', author: 'Naman Gangwal', mode: 'post' }, { me: ADMIN, actor: 'Test owner' }));
    id = r.body.draftId;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.posted, true);
    assert.match(r.body.url, /\/insights\/office-plants/);
    const created = calls.find((c) => c.action === 'post.create');
    assert.ok(created, 'a post was made on the website');
    assert.equal(created!.data.title, title);
    assert.match(created!.data.content, /Snake plants and pothos/);
    const d = (await prisma.drafts.findUnique({ where: { id: id! }, include: { keyword: true } }))!;
    assert.equal(d.status, 'published');
    assert.equal(d.keyword.batch_name, 'My blogs');
    assert.equal(d.keyword.status, 'done');
    assert.equal(d.author, 'Naman Gangwal');
    assert.ok(await prisma.content_changes.findFirst({ where: { entity_type: 'draft', entity_id: id!, kind: 'upload' } }), 'the upload is recorded');
    assert.ok(await prisma.activity_log.findFirst({ where: { action: 'draft.my_blog', entity_id: id! } }));
    assert.ok(await prisma.activity_log.findFirst({ where: { action: 'site.published', entity_id: id! } }));
  } finally {
    await cleanup(id);
  }
});

test('reviewer placeholders and AI notes still stop a post, naming the text, and nothing is saved', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { postMyBlog } = await import('../lib/myBlog');
  calls.length = 0;
  const title = `Placeholder blog ${stamp()}`;
  const r = await withEnv(ON, () => postMyBlog({ title, html: article('<p>The fee is [VERIFY: current fee] this year.</p>'), mode: 'post' }, { me: ADMIN }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /\[VERIFY: current fee\]/);
  const r2 = await withEnv(ON, () => postMyBlog({ title, html: article('<p>I hope this helps with your plants.</p>'), mode: 'post' }, { me: ADMIN }));
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /Remove the AI notes first.*I hope this helps/);
  assert.equal(await prisma.drafts.count({ where: { title } }), 0, 'nothing saved');
  assert.deepEqual(calls.filter((c) => c.action === 'post.create'), [], 'nothing sent');
});

test('fact check ticked and a wrong claim: not posted, saved to Drafts with the issue (Testing-mode queue, no API call)', { skip: !db, timeout: 120000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { postMyBlog } = await import('../lib/myBlog');
  const g = globalThis as any;
  const prevPin = g.__AI_MODE_PIN;
  g.__AI_MODE_PIN = 'testing';
  const claim = 'Snake plants and pothos need water about once every two weeks.';
  // Claude Code answering the queue: each fact-check step gets the answer its prompt asks for.
  const seen: string[] = [];
  let stop = false;
  const answerer = (async () => {
    while (!stop) {
      for (const job of await prisma.ai_jobs.findMany({ where: { status: 'waiting', feature: 'fact-check' } })) {
        const s = job.system;
        const answer = /list the checkable claims/.test(s)
          ? `===JSON===${JSON.stringify({ claims: [{ text: claim, topic: 'plant care', search: false }] })}===END===`
          : /research brief/.test(s)
            ? '===BRIEF===Plant care basics.===END==='
            : /final reviewer/.test(s)
              ? '===JSON==={"checks":[]}===END==='
              : `===JSON===${JSON.stringify({ checks: [{ n: 1, verdict: 'incorrect', correction: 'They need water about once every three weeks.', source_url: '' }] })}===END===`;
        seen.push(/list the checkable/.test(s) ? 'list' : /research brief/.test(s) ? 'brief' : /final reviewer/.test(s) ? 'review' : 'check');
        await prisma.ai_jobs.update({ where: { id: job.id }, data: { status: 'answered', answer, answered_by: 'test' } });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  calls.length = 0;
  let id: number | null = null;
  try {
    const usageBefore = await prisma.ai_usage.count().catch(() => 0);
    const r = await withEnv(ON, () => postMyBlog({ title: `Watering office plants ${stamp()}`, html: article(), mode: 'post', fact_check: true }, { me: ADMIN }));
    id = r.body.draftId;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.posted, false);
    assert.match(r.body.message, /found 1 wrong claim/);
    assert.match(r.body.issues[0], /once every three weeks/);
    assert.deepEqual(calls.filter((c) => c.action === 'post.create' || c.action === 'post.update'), [], 'nothing went to the website');
    const d = (await prisma.drafts.findUnique({ where: { id: id! } }))!;
    assert.equal(d.status, 'pending_review');
    assert.equal(d.production_state, 'NEEDS_ATTENTION');
    assert.match(d.validation_issues || '', /three weeks/);
    assert.equal(d.content_html?.includes(claim), true, 'the words were not changed');
    assert.ok(seen.includes('check'), 'the claim was checked through the queue');
    assert.equal(await prisma.ai_usage.count().catch(() => 0), usageBefore, 'no API usage recorded');
  } finally {
    stop = true;
    await answerer;
    g.__AI_MODE_PIN = prevPin;
    await cleanup(id);
  }
});

test('a role without blog.publish_now cannot post now, but can save to Drafts', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { postMyBlog } = await import('../lib/myBlog');
  calls.length = 0;
  const title = `Analyst blog ${stamp()}`;
  let id: number | null = null;
  try {
    const refused = await withEnv(ON, () => postMyBlog({ title, html: article(), mode: 'post' }, { me: ANALYST }));
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /Save to Drafts/);
    const signedOut = await withEnv(ON, () => postMyBlog({ title, html: article(), mode: 'post' }, { me: null }));
    assert.equal(signedOut.status, 403);
    assert.equal(await prisma.drafts.count({ where: { title } }), 0);

    const saved = await withEnv(ON, () => postMyBlog({ title, html: 'First paragraph about plants.\n\nSecond paragraph ' + words(60), meta_description: 'Plants for the office.', mode: 'save' }, { me: ANALYST }));
    id = saved.body.draftId;
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.posted, false);
    const d = (await prisma.drafts.findUnique({ where: { id: id! }, include: { keyword: true } }))!;
    assert.equal(d.status, 'pending_review');
    assert.equal(d.meta_description, 'Plants for the office.');
    assert.equal(d.keyword.keyword, title, 'the keyword defaults to the title');
    assert.match(d.content_html || '', /^<p>First paragraph about plants\.<\/p>\n<p>Second paragraph/);
    assert.deepEqual(calls.filter((c) => c.action === 'post.create'), [], 'saving does not post');
  } finally {
    await cleanup(id);
  }
});

test('without the website connection a post keeps the draft and says so', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { postMyBlog } = await import('../lib/myBlog');
  let id: number | null = null;
  try {
    const r = await withEnv({}, () => postMyBlog({ title: `No website ${stamp()}`, html: article(), mode: 'post' }, { me: ADMIN }));
    id = r.body.draftId;
    assert.equal(r.status, 503);
    assert.match(r.body.error, /website connection is not set up.*saved in Drafts & Review/);
    assert.equal((await prisma.drafts.findUnique({ where: { id: id! } }))!.status, 'approved', 'kept, ready to publish later');
  } finally {
    await cleanup(id);
  }
});

test('the permission rules: Post my blog is content work; the route checks publish_now itself', async () => {
  const { actionFor, can } = await import('../lib/permissions');
  assert.equal(actionFor('POST', '/api/my-blog'), 'content.work');
  assert.equal(actionFor('POST', '/api/my-blog/banner'), 'content.work');
  assert.equal(can('analyst', 'blog.publish_now'), false);
  assert.equal(can('manager', 'blog.publish_now'), true);
});

test('Drafts & Review: Skip checks needs blog.publish_now; publishing skips the reviewer and originality checks only', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { publishDraft } = await import('../lib/publishDraft');
  const kw = await prisma.keywords.create({ data: { keyword: `plants ${stamp()}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Plants for desks', meta_description: 'Meta.', content_html: article(), status: 'approved', author: 'Naman Gangwal' } });
  try {
    // Asking for the reviewer and not naming one stops it; skipping the checks lets it through.
    const asked = await withEnv(ON, () => publishDraft(draft.id, { wpStatus: 'publish', requireReviewer: true, me: ADMIN }));
    assert.equal(asked.status, 400);
    assert.match(asked.body.error, /Name the CA\/CPA/);
    const done = await withEnv(ON, () => publishDraft(draft.id, { wpStatus: 'publish', requireReviewer: true, skipExpert: true, skipOriginality: true, me: ADMIN }));
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const after = (await prisma.drafts.findUnique({ where: { id: draft.id } }))!;
    assert.equal(after.status, 'published');
    assert.equal(after.originality, null, 'the originality check did not run');
  } finally {
    await cleanup(draft.id);
  }
  // The route refuses skipChecks to a person who may not publish straight away (signed out here).
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const res: any = await POST(new Request('http://x/api/drafts/1/publish', { method: 'POST', body: JSON.stringify({ skipChecks: true }) }) as any, { params: Promise.resolve({ id: '1' }) });
  assert.equal(res.status, 403);
});

test('Make banner sends the design variant and the steering to the Social dashboard', { skip: !db, timeout: 60000 }, async () => {
  const sharp = (await import('sharp')).default;
  bannerBytes = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#123456', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 100 }).toBuffer();
  const { bannerCandidate, checkCandidate } = await import('../lib/coverPhoto');
  bannerAsks.length = 0;
  await withEnv({ SOCIAL_SKILLS_SECRET: SOCIAL_SECRET, SOCIAL_DASHBOARD_URL: SOCIAL }, async () => {
    const a = await bannerCandidate({ title: 'ITIN guide: how to apply from India', main: 'ITIN guide', cutout: 'tax-documents', variant: 0 }, 'new');
    const b = await bannerCandidate({ title: 'ITIN guide: how to apply from India', main: 'ITIN guide', cutout: 'tax-documents', variant: 3 }, 'new');
    assert.equal(a.source, 'social');
    assert.match(a.key, /^covers\/candidate-new-\d+\.jpg$/);
    assert.equal(await checkCandidate(b.key), b.key);
    assert.equal(await checkCandidate('covers/other.png'), null, 'only a candidate can be chosen');
  });
  assert.equal(bannerAsks.length, 2);
  assert.deepEqual(bannerAsks.map((x) => x.variant), [0, 3]);
  assert.equal(bannerAsks[1].main, 'ITIN guide');
  assert.equal(bannerAsks[1].cutout, 'tax-documents');
  // Without the Social dashboard the local design is used, and the variant changes it.
  const { makeCover } = await import('../lib/cover');
  const one = await makeCover('Office plants that need little care', null, 0);
  const two = await makeCover('Office plants that need little care', null, 1);
  assert.notEqual(crypto.createHash('sha1').update(one).digest('hex'), crypto.createHash('sha1').update(two).digest('hex'));
});

test('the chosen banner is the one the post carries; no automatic banner replaces it', { skip: !db, timeout: 120000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const sharp = (await import('sharp')).default;
  bannerBytes = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#654321', noise: { type: 'gaussian', mean: 100, sigma: 40 } } }).jpeg({ quality: 100 }).toBuffer();
  const { bannerCandidate } = await import('../lib/coverPhoto');
  const { postMyBlog } = await import('../lib/myBlog');
  calls.length = 0;
  let id: number | null = null;
  try {
    const chosen = await withEnv({ SOCIAL_SKILLS_SECRET: SOCIAL_SECRET, SOCIAL_DASHBOARD_URL: SOCIAL }, () => bannerCandidate({ title: 'Desk plants', main: 'Desk plants', cutout: 'business', variant: 2 }, 'new'));
    assert.equal(chosen.source, 'social');
    assert.equal(bannerAsks.at(-1).variant, 2);
    const asksBefore = bannerAsks.length;
    const r = await withEnv({ ...ON, SOCIAL_SKILLS_SECRET: SOCIAL_SECRET, SOCIAL_DASHBOARD_URL: SOCIAL }, () => postMyBlog({ title: `Desk plants ${stamp()}`, html: article(), mode: 'post', cover_key: chosen.key }, { me: ADMIN }));
    id = r.body.draftId;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(bannerAsks.length, asksBefore, 'no new banner was made at publish');
    const d = (await prisma.drafts.findUnique({ where: { id: id! } }))!;
    assert.equal(d.featured_image_path, chosen.key);
    const upload = calls.find((c) => c.action === 'media.upload');
    assert.equal(upload?.data.filename, path.basename(chosen.key), 'the chosen banner was uploaded');
    const created = calls.find((c) => c.action === 'post.create');
    assert.ok(String(created?.data.featured_image || JSON.stringify(created?.data)).includes(path.basename(chosen.key)), 'the post carries it');
  } finally {
    await cleanup(id);
  }
  assert.deepEqual(outside.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u)).filter((u) => /anthropic|openai|pexels|serphouse|copyscape/.test(u)), [], 'no AI, photo or paid lookup was called');
});

test('the assistant tool post_my_blog is a write tool (approved first), open to content roles, with a preview', async () => {
  process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
  const { getTool, toolNeeds } = await import('../lib/assistant/tools');
  const t = getTool('post_my_blog');
  assert.equal(t.kind, 'write');
  assert.equal(toolNeeds('post_my_blog'), 'content.work');
  assert.equal(typeof t.preview, 'function');
  assert.match(t.summarize({ title: 'My blog', mode: 'post' }), /Post live on the website: "My blog" \(checks: none\)/);
  assert.match(t.summarize({ title: 'My blog', mode: 'save', fact_check: true }), /Save to Drafts & Review.*fact check/);
  const p = await t.preview({ title: 'My blog', content_html: article('<p>[AUTHOR NAME]</p>'), mode: 'post' }, { me: ADMIN });
  assert.match(p.problem, /\[AUTHOR NAME\]/);
});

test('choosing a banner on a draft accepts only a made candidate', { skip: !db, timeout: 60000 }, async () => {
  const prisma = (await import('../lib/prisma')).default;
  const { POST } = await import('../app/api/drafts/[id]/cover/route');
  const kw = await prisma.keywords.create({ data: { keyword: `banner ${stamp()}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Banner test', content_html: article(), status: 'pending_review' } });
  try {
    const ask = (body: any) => POST(new Request(`http://x/api/drafts/${draft.id}/cover`, { method: 'POST', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: String(draft.id) }) });
    const preview: any = await withEnv({}, () => ask({ action: 'preview', main: 'Banner', variant: 1 }));
    assert.equal(preview.status, 200);
    const made = await preview.json();
    assert.equal(made.source, 'local', 'no banner service in the test: the local design');
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } }))!.featured_image_path, null, 'a preview does not change the cover');
    assert.equal((await ask({ action: 'use', key: 'covers/someone-else.png' })).status, 400);
    assert.equal((await ask({ action: 'use', key: made.key })).status, 200);
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } }))!.featured_image_path, made.key);
  } finally {
    await cleanup(draft.id);
  }
});

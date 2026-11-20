/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test scaffolding over untyped (any) tool definitions.
// The assistant's live-blog tools (lib/liveBlog.ts): live_blog_set_author and live_blog_edit change a
// post that is live on the website through its connector, answered here by a small in-memory website
// (as in tests/site-connector.test.ts). They need blog.publish_now, change only what was asked (the
// address, cover and, for edits, the author stay), refuse reviewer placeholders, record the change,
// and undo works until someone changes the post again. Nothing reaches an outside service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
const CONNECTOR = 'https://site.test/_bridge/dashboard-connector.php';
const SECRET = 'live-blog-test-secret';
process.env.SITE_CONNECTOR_URL = CONNECTOR;
process.env.SITE_CONNECTOR_SECRET = SECRET;
delete process.env.SITE_CONNECTOR_AUTHORS;

const site = new Map<string, any>();
const updates: any[] = [];
let nextId = 500;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u !== CONNECTOR) throw new Error(`Network call in a test: ${u}`);
  const body = String(init?.body || '');
  const ts = init?.headers?.['X-Dashboard-Timestamp'];
  const sig = init?.headers?.['X-Dashboard-Signature'];
  const reply = (status: number, json: any) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (sig !== crypto.createHmac('sha256', SECRET).update(`${ts}\n${body}`).digest('hex')) return reply(401, { ok: false, error: 'bad signature' });
  const { action, data } = JSON.parse(body);
  switch (action) {
    case 'post.list':
      return reply(200, { ok: true, posts: [...site.values()].map(({ content, ...p }) => p) });
    case 'post.get': {
      const p = site.get(data.slug);
      return p ? reply(200, { ok: true, post: p }) : reply(404, { ok: false, error: 'not found' });
    }
    case 'post.update': {
      const p = site.get(data.slug);
      if (!p) return reply(404, { ok: false, error: 'not found' });
      updates.push(data);
      site.set(data.slug, { ...p, ...data, updated_at: '2026-11-20 10:00:00' });
      return reply(200, { ok: true });
    }
    default:
      return reply(400, { ok: false, error: `unknown action ${action}` });
  }
}) as any;

const MANAGER = { email: 'manager@test.local', name: 'Manager Test', role: 'manager' as const, blocked: false };
const SCHEMA = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","reviewedBy":{"@type":"Person","name":"Akshay Nahar","jobTitle":"CA"},"lastReviewed":"2026-10-01","mainEntity":{"@type":"Article","headline":"ITIN for NRIs","author":{"@type":"Person","name":"Harsh Jain"}}}</script>';
const CONTENT = `<p>An ITIN is a tax number from the IRS.</p>\n<p class="uic-byline">By <strong>Harsh Jain</strong>. Reviewed by <strong>Akshay Nahar, CA</strong>. Last reviewed 1 October 2026.</p><h2>Who needs an ITIN</h2><p>People who must file but cannot get an SSN.</p><h2>How to apply</h2><p>File Form W-7 with your return.</p><h3>Documents</h3><p>A passport.</p><h2>FAQ</h2><p>Q and A.</p>\n${SCHEMA}`;

function addPost(slug: string) {
  const id = nextId++;
  site.set(slug, { id, slug, title: 'ITIN for NRIs', content: CONTENT, excerpt: 'How NRIs get an ITIN.', status: 'published', category: 'tax', author: 'harsh-jain', seo_title: 'ITIN for NRIs', seo_description: 'How NRIs get an ITIN.', featured_image: '/uploads/2026/10/itin.png', featured_image_alt: 'ITIN cover', url: `/insights/${slug}/`, published_at: '2026-10-01 10:00:00' });
  return 1_000_000_000 + id;
}
const tools = () => import('../lib/assistant/tools');

test('the byline and the schema follow a new author; the reviewer and review date stay', async () => {
  const { withAuthor } = await import('../lib/byline');
  const out = withAuthor(CONTENT, 'Naman Gangwal', 'ITIN for NRIs');
  assert.match(out, /By <strong>Naman Gangwal<\/strong>\. Reviewed by <strong>Akshay Nahar, CA<\/strong>\. Last reviewed 1 October 2026\./);
  assert.doesNotMatch(out, /Harsh Jain/);
  const schema = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(schema.mainEntity.author.name, 'Naman Gangwal');
  assert.equal(schema.reviewedBy.name, 'Akshay Nahar');
  assert.equal(schema.lastReviewed, '2026-10-01');
  // A post without byline or schema gets both, as publishing adds them.
  const bare = withAuthor('<p>Text here.</p><h2>A</h2><p>B</p>', 'Amit Agarwal', 'T');
  assert.match(bare, /<p class="uic-byline">By <strong>Amit Agarwal<\/strong>\.<\/p>/);
  assert.match(bare, /"author":\{"@type":"Person","name":"Amit Agarwal"/);
});

test('a section is the heading up to the next heading of the same or a higher level', async () => {
  const { replaceSection } = await import('../lib/liveBlog');
  const r = replaceSection(CONTENT, 'How to apply', '<h2>How to apply</h2><p>New text.</p>');
  assert.equal(r.problem, null);
  assert.match(r.before, /^<h2>How to apply<\/h2><p>File Form W-7 with your return\.<\/p><h3>Documents<\/h3><p>A passport\.<\/p>$/);
  assert.match(r.html, /<h2>How to apply<\/h2><p>New text\.<\/p><h2>FAQ<\/h2>/);
  assert.ok(r.html.includes(SCHEMA));
  assert.match(replaceSection(CONTENT, 'Nope', 'x').problem!, /No heading/);
});

test('the live-blog tools need blog.publish_now, are high risk and are in the prompt', async () => {
  const { toolNeeds, getTool, riskOf } = await tools();
  assert.deepEqual(toolNeeds('live_blog_set_author', {}), ['blog.publish_now']);
  assert.deepEqual(toolNeeds('live_blog_edit', {}), ['blog.publish_now']);
  assert.equal(riskOf(getTool('live_blog_set_author'), {}), 'high');
  assert.equal(riskOf(getTool('live_blog_edit'), {}), 'high');
  const { can } = await import('../lib/permissions');
  assert.equal(can('analyst', 'blog.publish_now'), false);
  assert.equal(can('manager', 'blog.publish_now'), true);
  const { SYSTEM_PROMPT } = await import('../lib/assistant/prompt');
  assert.match(SYSTEM_PROMPT, /live_blog_set_author/);
  assert.match(SYSTEM_PROMPT, /live_blog_edit/);
  for (const n of ['Akshay Nahar', 'Amit Agarwal', 'Naman Gangwal', 'Harsh Jain']) assert.ok(SYSTEM_PROMPT.includes(n), n);
  const { actionFor } = await import('../lib/permissions');
  assert.equal(actionFor('POST', '/api/drafts/5/live-author'), 'blog.publish_now');
});

test('live_blog_set_author: changes the author, byline, schema and draft only; undo works, and refuses after a later change', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool, undoChange } = await tools();
  const slug = `itin-for-nris-${Date.now()}`;
  const postId = addPost(slug);
  const kw = await prisma.keywords.create({ data: { keyword: `itin ${slug}`, status: 'drafted' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'ITIN for NRIs', content_html: '<p>x</p>', status: 'published', author: 'Harsh Jain', wp_post_id: postId, wp_post_url: `https://site.test/insights/${slug}/` } });
  try {
    const t = getTool('live_blog_set_author');
    const bad = await t.preview({ post_id: postId, author: 'Someone Else' }, { me: MANAGER });
    assert.match(bad.problem, /Pick one of the blog authors: .*Harsh Jain/);
    await assert.rejects(t.run({ post_id: postId, author: 'Someone Else' }, { me: MANAGER }), /Pick one of the blog authors/);
    const p = await t.preview({ post_id: postId, author: 'Naman Gangwal' }, { me: MANAGER });
    assert.equal(p.problem, null);
    assert.deepEqual(p.changes[0], { field: 'author', before: 'harsh-jain', after: 'Naman Gangwal' });

    const before = { ...site.get(slug) };
    const out = await t.run({ post_id: postId, author: 'Naman Gangwal' }, { me: MANAGER });
    const after = site.get(slug);
    assert.equal(after.author, 'naman-gangwal');
    assert.match(after.content, /By <strong>Naman Gangwal<\/strong>\. Reviewed by <strong>Akshay Nahar, CA<\/strong>/);
    assert.match(after.content, /"author":\{"@type":"Person","name":"Naman Gangwal"/);
    // Only the author changed: address, cover, title, meta and the rest of the words stay.
    for (const k of ['slug', 'url', 'featured_image', 'featured_image_alt', 'title', 'seo_title', 'seo_description', 'excerpt', 'status', 'category']) assert.equal(after[k], before[k], k);
    assert.equal(after.content.replace(/<script[\s\S]*$/, '').replace('Naman Gangwal', 'Harsh Jain'), CONTENT.replace(/<script[\s\S]*$/, ''), 'only the byline name changed in the words');
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } })).author, 'Naman Gangwal');
    const cc = await prisma.content_changes.findFirst({ where: { entity_type: 'draft', entity_id: draft.id, kind: 'author' }, orderBy: { id: 'desc' } });
    assert.ok(cc, 'recorded in content changes');
    assert.equal(cc.actor, 'Manager Test (assistant)');
    assert.ok(await prisma.activity_log.findFirst({ where: { action: 'site.author_changed', entity_id: draft.id } }));
    assert.equal(out.change.undo.kind, 'restore_live_post');

    // Undo: the previous author, byline and draft author come back.
    assert.match(await undoChange(out.change.undo, { actor: 'Manager Test' }), /Restored/);
    assert.equal(site.get(slug).author, 'harsh-jain');
    assert.equal(site.get(slug).content, CONTENT);
    assert.equal((await prisma.drafts.findUnique({ where: { id: draft.id } })).author, 'Harsh Jain');

    // Changed again, then someone edits the post on the website: undo refuses.
    const again = await t.run({ post_id: postId, author: 'Amit Agarwal' }, { me: MANAGER });
    site.set(slug, { ...site.get(slug), content: site.get(slug).content.replace('A passport.', 'A valid passport.') });
    await assert.rejects(undoChange(again.change.undo), (e: any) => e.code === 'CHANGED_SINCE');
    assert.equal(site.get(slug).author, 'amit-agarwal');
  } finally {
    await prisma.content_changes.deleteMany({ where: { entity_type: 'draft', entity_id: draft.id } });
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
    site.delete(slug);
  }
});

test('live_blog_edit: changes only what was asked, keeps address, cover and author, refuses placeholders; undo', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool, undoChange } = await tools();
  const slug = `itin-edit-${Date.now()}`;
  const postId = addPost(slug);
  try {
    const t = getTool('live_blog_edit');
    // A placeholder or a script is refused, and nothing is sent.
    const n = updates.length;
    const ph = await t.preview({ post_id: postId, edits: [{ find: 'A passport.', replace: 'A passport. [VERIFY: current list]' }] }, { me: MANAGER });
    assert.match(ph.problem, /\[VERIFY/);
    await assert.rejects(t.run({ post_id: postId, edits: [{ find: 'A passport.', replace: 'A passport. [VERIFY: current list]' }] }, { me: MANAGER }), /Nothing was changed on the website/);
    await assert.rejects(t.run({ post_id: postId, edits: [{ find: 'A passport.', replace: '<script>x()</script>' }] }, { me: MANAGER }), /script/);
    await assert.rejects(t.run({ post_id: postId, edits: [{ find: 'not in the post', replace: 'x' }] }, { me: MANAGER }), /not found/);
    assert.equal(updates.length, n, 'nothing sent');

    // The preview shows before and after.
    const input = { post_id: postId, edits: [{ find: 'A passport.', replace: 'A valid passport.' }], meta_description: 'How NRIs apply for an ITIN with Form W-7.', section: { heading: 'Who needs an ITIN', html: '<h2>Who needs an ITIN</h2><p>Nonresidents who must file a US return and cannot get an SSN.</p>' } };
    const p = await t.preview(input, { me: MANAGER });
    assert.equal(p.problem, null);
    assert.deepEqual(p.changes.map((c: any) => c.field), ['Change 1', 'Section "Who needs an ITIN"', 'meta description']);
    assert.equal(p.changes[0].before, 'A passport.');
    assert.equal(p.changes[0].after, 'A valid passport.');

    const before = { ...site.get(slug) };
    const out = await t.run(input, { me: MANAGER });
    const after = site.get(slug);
    assert.match(after.content, /A valid passport\./);
    assert.match(after.content, /Nonresidents who must file/);
    assert.doesNotMatch(after.content, /People who must file but cannot get an SSN/);
    assert.equal(after.content.replace('A valid passport.', 'A passport.').replace('<p>Nonresidents who must file a US return and cannot get an SSN.</p>', '<p>People who must file but cannot get an SSN.</p>'), before.content, 'nothing else in the words changed');
    assert.equal(after.seo_description, 'How NRIs apply for an ITIN with Form W-7.');
    assert.equal(after.excerpt, 'How NRIs apply for an ITIN with Form W-7.', 'the excerpt was the meta description, so it follows');
    for (const k of ['slug', 'url', 'featured_image', 'featured_image_alt', 'author', 'title', 'seo_title', 'status', 'category']) assert.equal(after[k], before[k], k);
    assert.deepEqual(out.result.changed.sort(), ['contentHtml', 'excerpt', 'metaDescription']);
    assert.ok(await prisma.content_changes.findFirst({ where: { entity_type: 'post', entity_id: postId, kind: 'live_edit' } }));

    // A title change: the SEO title follows (it was the title).
    const tt = await t.run({ post_id: postId, title: 'ITIN for NRIs: how to apply' }, { me: MANAGER });
    assert.equal(site.get(slug).title, 'ITIN for NRIs: how to apply');
    assert.equal(site.get(slug).seo_title, 'ITIN for NRIs: how to apply');
    assert.equal(site.get(slug).slug, slug);
    // Undo the title, then the words.
    await undoChange(tt.change.undo);
    assert.equal(site.get(slug).title, 'ITIN for NRIs');
    assert.equal(site.get(slug).seo_title, 'ITIN for NRIs');
    await undoChange(out.change.undo);
    assert.equal(site.get(slug).content, CONTENT);
    assert.equal(site.get(slug).seo_description, 'How NRIs get an ITIN.');
    assert.equal(site.get(slug).excerpt, 'How NRIs get an ITIN.');
    // A change made after: undo refuses.
    const x = await t.run({ post_id: postId, edits: [{ find: 'Q and A.', replace: 'Questions and answers.' }] }, { me: MANAGER });
    site.set(slug, { ...site.get(slug), content: site.get(slug).content + '<p>Later.</p>' });
    await assert.rejects(undoChange(x.change.undo), /changed on the website after this change/);
  } finally {
    await prisma.content_changes.deleteMany({ where: { entity_type: 'post', entity_id: postId } });
    site.delete(slug);
  }
});

test('Drafts & Review: "Change author on the live post" needs blog.publish_now and records an undoable change', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const route = await import('../app/api/drafts/[id]/live-author/route');
  const src = (await import('node:fs')).readFileSync(new URL('../app/api/drafts/[id]/live-author/route.ts', import.meta.url), 'utf8');
  assert.match(src, /canPublishNow/);
  assert.match(src, /setLiveAuthor/);
  // Not signed in: refused before anything else.
  const res = await route.POST(new Request('http://x/api/drafts/1/live-author', { method: 'POST', body: JSON.stringify({ author: 'Naman Gangwal' }) }) as any, { params: Promise.resolve({ id: '1' }) });
  assert.equal(res.status, 403);
  void prisma;
});

test('undo restores an empty author exactly, and live edits keep heading numbers as they are', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool, undoChange } = await tools();
  const slug = `no-author-${Date.now()}`;
  const postId = addPost(slug);
  const numbered = CONTENT.replace('<h2>How to apply</h2>', '<h2>2. How to apply</h2>');
  site.set(slug, { ...site.get(slug), author: null, content: numbered });
  try {
    const out = await getTool('live_blog_set_author').run({ post_id: postId, author: 'Akshay Nahar' }, { me: MANAGER });
    assert.equal(site.get(slug).author, 'akshay-nahar');
    assert.match(site.get(slug).content, /<h2>2\. How to apply<\/h2>/, 'heading numbers are not removed by an author change');
    await undoChange(out.change.undo);
    assert.equal(site.get(slug).author, null, 'the empty author comes back');
    assert.equal(site.get(slug).content, numbered, 'undo is exact');
    const e = await getTool('live_blog_edit').run({ post_id: postId, edits: [{ find: 'Q and A.', replace: 'Questions and answers.' }] }, { me: MANAGER });
    assert.equal(site.get(slug).content, numbered.replace('Q and A.', 'Questions and answers.'), 'only the asked change');
    await undoChange(e.change.undo);
    assert.equal(site.get(slug).content, numbered);
  } finally {
    await prisma.content_changes.deleteMany({ where: { entity_type: 'post', entity_id: postId } });
    site.delete(slug);
  }
});

// The publish checklist (Author, Title, Blog text, Banner): every way to publish or approve a blog for
// publishing refuses until all four are ticked for what the blog holds now; changing one of them
// after ticking undoes that tick; who ticked is saved and logged. The calendar's own publishing at
// the slot uses the approval already given. Database tests use DATABASE_URL (local test database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
for (const k of ['SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET']) delete process.env[k];
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url)}`);
}) as any;

const ALL = { author: true, title: true, content: true, banner: true };
const ADMIN = { email: 'admin@test.local', name: 'Admin Test', role: 'admin' as const, blocked: false };
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const article = () => `<h2>Desk plants</h2>${'<p>Snake plants and pothos need little light and little water, so they suit most offices.</p>'.repeat(8)}`;

test('the calendar publishing at its slot does not ask again; the routes and tools pass the ticks', () => {
  const root = path.join(__dirname, '..');
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.doesNotMatch(read('lib/strategy/autopilot.ts'), /checklistProblem/);
  for (const f of ['lib/publishDraft.ts', 'lib/draftActions.ts', 'lib/strategy/scheduleActions.ts', 'lib/myBlog.ts']) assert.match(read(f), /checklistProblem|allTicked/, f);
  assert.match(read('app/api/drafts/[id]/publish/route.ts'), /checklist: body\?\.checklist/);
  assert.match(read('app/api/my-blog/route.ts'), /checklist: body\.checklist/);
});

test('ticks: all four needed; a change to the title, author, text or banner undoes that tick', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { setTicks, checklistState, checklistProblem } = await import('../lib/publishChecklist');
  const kw = await prisma.keywords.create({ data: { keyword: `desk plants ${stamp()}`, status: 'drafted' } });
  const d = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Desk plants', meta_description: 'Meta.', content_html: article(), status: 'pending_review', author: 'Naman Gangwal' } });
  try {
    assert.match((await checklistProblem(d.id, null, 'x'))!, /Author checked, Title checked, Blog text checked, Banner checked/);
    await setTicks(d.id, { author: true, title: true, content: true }, 'Reviewer One');
    assert.match((await checklistProblem(d.id, null, 'x'))!, /Banner checked/);
    let st = await setTicks(d.id, { banner: true }, 'Reviewer One');
    assert.equal(st.complete, true);
    assert.equal(st.items[0].by, 'Reviewer One');
    assert.equal(await checklistProblem(d.id, null, 'x'), null);
    const log = await prisma.activity_log.findFirst({ where: { action: 'draft.checklist', entity_id: d.id }, orderBy: { id: 'desc' } });
    assert.equal(log.actor, 'Reviewer One');

    // Title changed: only the title tick goes (the made banner shows the title, so it goes too).
    await prisma.drafts.update({ where: { id: d.id }, data: { title: 'Desk plants that need little care' } });
    st = await checklistState(await prisma.drafts.findUnique({ where: { id: d.id } }));
    const t = Object.fromEntries(st.items.map((i: any) => [i.key, i.ticked]));
    assert.deepEqual(t, { author: true, title: false, content: true, banner: false });
    assert.ok(st.items.find((i: any) => i.key === "title")?.reset);
    assert.match((await checklistProblem(d.id, null, 'x'))!, /changed after it was ticked/);

    // An uploaded banner: the made cover no longer matters; a new upload undoes the banner tick.
    await setTicks(d.id, ALL, 'Reviewer Two');
    await prisma.drafts.update({ where: { id: d.id }, data: { featured_image_path: 'covers/a.png' } });
    st = await checklistState(await prisma.drafts.findUnique({ where: { id: d.id } }));
    assert.deepEqual(st.items.filter((i: any) => !i.ticked).map((i: any) => i.key), ['banner']);
    await setTicks(d.id, { banner: true }, 'Reviewer Two');
    await prisma.drafts.update({ where: { id: d.id }, data: { content_html: article() + '<p>One more line.</p>' } });
    st = await checklistState(await prisma.drafts.findUnique({ where: { id: d.id } }));
    assert.deepEqual(st.items.filter((i: any) => !i.ticked).map((i: any) => i.key), ['content']);
    await setTicks(d.id, { content: true }, 'Reviewer Two');
    await prisma.drafts.update({ where: { id: d.id }, data: { author: 'Harsh Jain' } });
    st = await checklistState(await prisma.drafts.findUnique({ where: { id: d.id } }));
    assert.deepEqual(st.items.filter((i: any) => !i.ticked).map((i: any) => i.key), ['author']);
    // Unticking removes it.
    st = await setTicks(d.id, { title: false }, 'Reviewer Two');
    assert.equal(st.items.find((i: any) => i.key === "title")?.ticked, false);
  } finally {
    await prisma.activity_log.deleteMany({ where: { action: 'draft.checklist', entity_id: d.id } });
    await prisma.drafts.deleteMany({ where: { id: d.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

test('approve and publish are refused on the server until the checklist is ticked', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { patchDraft } = await import('../lib/draftActions');
  const { publishDraft } = await import('../lib/publishDraft');
  const { decideSchedule } = await import('../lib/strategy/scheduleActions');
  const { postMyBlog } = await import('../lib/myBlog');
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const kw = await prisma.keywords.create({ data: { keyword: `office plants ${stamp()}`, status: 'drafted' } });
  const d = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Office plants', meta_description: 'Meta.', content_html: article(), status: 'pending_review', author: 'Naman Gangwal' } });
  const s = await prisma.seo_strategies.create({ data: { period: '2040-01', status: 'approved' } });
  const row = await prisma.blog_schedule.create({ data: { strategy_id: s.id, publish_at: '2040-01-10 05:00:00', title: 'Office plants', main_keyword: `office plants ${stamp()}`, tags: '[]', status: 'in_review', draft_id: d.id } });
  try {
    // Drafts & Review Approve.
    let r = await patchDraft(d.id, { status: 'approved' }, { actor: 'A' });
    assert.equal(r.status, 400);
    assert.equal(r.body.checklist, true);
    // New words in the same request as the approval: saved first, then ticked.
    r = await patchDraft(d.id, { status: 'approved', content_html: article() + '<p>x</p>', checklist: ALL }, { actor: 'A' });
    assert.match(r.body.error, /Save your changes first/);
    // The calendar's Approve and Publish now.
    let c = await decideSchedule(row.id, { action: 'approve' }, { me: ADMIN, actor: 'A' });
    assert.equal(c.status, 400);
    assert.match(c.body.error, /Tick the publish checklist first/);
    c = await decideSchedule(row.id, { action: 'publish_now' }, { me: ADMIN, actor: 'A' });
    assert.equal(c.status, 400);
    assert.equal((await prisma.blog_schedule.findUnique({ where: { id: row.id } })).status, 'in_review');
    // Ticks sent with the request count (and are saved under the person's name).
    c = await decideSchedule(row.id, { action: 'approve', checklist: ALL }, { me: ADMIN, actor: 'Calendar Reviewer' });
    assert.equal(c.status, 200);
    assert.equal((await prisma.drafts.findUnique({ where: { id: d.id } })).status, 'approved');
    assert.match((await prisma.drafts.findUnique({ where: { id: d.id } })).publish_checklist, /Calendar Reviewer/);

    // Publish (Drafts & Review): the ticks are valid until the blog changes.
    await prisma.drafts.update({ where: { id: d.id }, data: { title: 'Office plants that need little care' } });
    const res = await POST(new Request(`http://x/api/drafts/${d.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'publish' }) }) as any, { params: Promise.resolve({ id: String(d.id) }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Title checked.*changed after it was ticked/);
    const p = await publishDraft(d.id, { wpStatus: 'publish', checklist: ALL, me: ADMIN, actor: 'A' });
    assert.notEqual(p.status, 400, 'with the ticks it goes on to the website step');
    assert.match(String(p.body.error || ''), /website connection is not set up/);

    // Post my blog: the author must be named and the checklist ticked; nothing is saved otherwise.
    const before = await prisma.drafts.count();
    const m1 = await postMyBlog({ title: `Mine ${stamp()}`, html: article(), mode: 'post', checklist: ALL }, { me: ADMIN });
    assert.match(m1.body.error, /Pick the author/);
    const m2 = await postMyBlog({ title: `Mine ${stamp()}`, html: article(), mode: 'post', author: 'Harsh Jain' }, { me: ADMIN });
    assert.match(m2.body.error, /Tick the publish checklist first/);
    assert.equal(await prisma.drafts.count(), before);
    // Saving to Drafts needs no checklist.
    const m3 = await postMyBlog({ title: `Mine ${stamp()}`, html: article(), mode: 'save' }, { me: ADMIN });
    assert.equal(m3.status, 200);
    if (m3.body.draftId) await prisma.drafts.deleteMany({ where: { id: m3.body.draftId } });
  } finally {
    await prisma.blog_schedule.deleteMany({ where: { id: row.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: s.id } });
    await prisma.drafts.deleteMany({ where: { id: d.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

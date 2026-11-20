// Listings and other tasks a person does stay on the dashboard after they are ticked: who and when,
// the listing's address and notes, from every month, with "Mark not done" for a mistaken tick. A
// listing unticked on the progress card goes back to the to-do list, never to the automatic outreach
// queue (which an edited strategy deletes). Database tests use DATABASE_URL (local test database only).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url)}`);
}) as any;

const MANAGER = { email: 'mgr-list@test.local', name: 'Manager List', role: 'manager' as const, blocked: false };
const USER = { email: 'user-list@test.local', name: 'User List', role: 'user' as const, blocked: false };

test('listing details are checked: web address, length, never a password', async () => {
  const { cleanDetails, signupLink } = await import('../lib/strategy/manual');
  assert.deepEqual(cleanDetails({ listingUrl: ' https://www.crunchbase.com/organization/x ', notes: 'Login: marketing@x.com' }), { listing_url: 'https://www.crunchbase.com/organization/x', listing_notes: 'Login: marketing@x.com' });
  assert.deepEqual(cleanDetails({ listingUrl: '', notes: '' }), { listing_url: null, listing_notes: null });
  assert.throws(() => cleanDetails({ listingUrl: 'crunchbase.com/x' }), /full web address/);
  assert.throws(() => cleanDetails({ notes: 'password: hunter2' }), /password/);
  assert.equal(signupLink('Sign up: https://bbb.org/get-listed. Trust listing.'), 'https://bbb.org/get-listed');
});

test('a ticked listing stays listed with who, when, address and notes; mark not done brings it back', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { listManualTasks } = await import('../lib/strategy/manual');
  const { manualTaskAction, setBacklinkStatus } = await import('../lib/strategy/manualActions');
  const old = await prisma.seo_strategies.create({ data: { period: '2026-10', status: 'superseded' } });
  const cur = await prisma.seo_strategies.create({ data: { period: '2026-11', status: 'approved' } });
  const note = 'Sign up: https://www.bbb.org/get-listed. Trust listing. Directory sign-up needs a person (forms and verification).';
  const t = await prisma.backlink_tasks.create({ data: { strategy_id: old.id, target_site: 'BBB (bbb.org)', method: 'Directory or citation listing', our_page: 'https://x/', send_date: '2026-10-05', tags: '[]', status: 'manual', note, assigned_to: USER.email } });
  try {
    // An open listing from last month is still on the list of this month.
    let tasks = await listManualTasks(cur.id);
    let mine = tasks.find((x) => x.kind === 'backlink' && x.id === t.id)!;
    assert.ok(mine && !mine.done);
    assert.equal(mine.link, 'https://www.bbb.org/get-listed');

    // A password is refused and nothing changes.
    const bad = await manualTaskAction({ kind: 'backlink', id: t.id, action: 'done', listingUrl: 'https://www.bbb.org/us/x', notes: 'pwd: abc' }, USER);
    assert.equal(bad.status, 400);
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: t.id } })).status, 'manual');

    const r = await manualTaskAction({ kind: 'backlink', id: t.id, action: 'done', listingUrl: 'https://www.bbb.org/us/x', notes: 'Login: marketing@usaindiacfo.com' }, USER);
    assert.equal(r.status, 200);
    const row = await prisma.backlink_tasks.findUnique({ where: { id: t.id } });
    assert.equal(row.status, 'done');
    assert.equal(row.note, note, 'the sign-up note is kept');
    assert.equal(row.done_by, USER.name);
    assert.equal(row.done_by_email, USER.email);
    assert.ok(row.done_at);

    tasks = await listManualTasks(cur.id);
    mine = tasks.find((x) => x.kind === 'backlink' && x.id === t.id)!;
    assert.ok(mine.done, 'a done listing from an earlier month is still listed');
    assert.equal(mine.doneBy, USER.name);
    assert.equal(mine.listingUrl, 'https://www.bbb.org/us/x');
    assert.equal(mine.notes, 'Login: marketing@usaindiacfo.com');
    assert.ok(mine.doneAt);

    // Details can be corrected later without unticking.
    assert.equal((await manualTaskAction({ kind: 'backlink', id: t.id, action: 'details', listingUrl: 'https://www.bbb.org/us/y' }, MANAGER)).status, 200);
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: t.id } })).listing_url, 'https://www.bbb.org/us/y');

    // Mark not done: back on the to-do list, the address and notes kept.
    assert.equal((await manualTaskAction({ kind: 'backlink', id: t.id, action: 'undo' }, MANAGER)).status, 200);
    const back = await prisma.backlink_tasks.findUnique({ where: { id: t.id } });
    assert.equal(back.status, 'manual');
    assert.equal(back.done_at, null);
    assert.equal(back.listing_url, 'https://www.bbb.org/us/y');
    assert.equal(back.note, note);

    // Ticked and unticked on the progress card: never sent to the automatic queue ("planned").
    assert.equal((await setBacklinkStatus(t.id, 'done', { me: MANAGER, actor: MANAGER.name })).status, 200);
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: t.id } })).done_by, MANAGER.name);
    assert.equal((await setBacklinkStatus(t.id, 'planned', { me: MANAGER, actor: MANAGER.name })).status, 200);
    assert.equal((await prisma.backlink_tasks.findUnique({ where: { id: t.id } })).status, 'manual');

    // A technical fix done by a person keeps its record too.
    const f = await prisma.technical_fix_tasks.create({ data: { strategy_id: old.id, url: 'https://x/a', issue: '404', fix: 'redirect', kind: 'redirect', status: 'manual' } });
    try {
      await manualTaskAction({ kind: 'fix', id: f.id, action: 'done', notes: 'Developer added the 301.' }, MANAGER);
      const fixDone = (await listManualTasks(cur.id)).find((x) => x.kind === 'fix' && x.id === f.id)!;
      assert.ok(fixDone.done && fixDone.doneBy === MANAGER.name && fixDone.notes === 'Developer added the 301.');
    } finally {
      await prisma.technical_fix_tasks.deleteMany({ where: { id: f.id } });
    }
  } finally {
    await prisma.backlink_tasks.deleteMany({ where: { id: t.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: { in: [old.id, cur.id] } } });
  }
});

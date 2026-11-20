// Review fixes for the training gate, the publish checklist and the lesson costs: rows from before
// the training's second version never lock anyone; lessons or tests made late (after 13:00 IST) do
// not lock that day; a blocked person is never locked and gets no lessons; every role can reach the
// training; the banner that is ticked is the banner published; the calendar button sends no ticks;
// a failing lesson is tried at most twice a day and once at a time. Database tests use DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
for (const k of ['SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET', 'PEXELS_API_KEY', 'OPENAI_API_KEY', 'SOCIAL_SKILLS_SECRET', 'SOCIAL_DASHBOARD_URL']) delete process.env[k];
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url)}`);
}) as any;

const ROOT = path.join(__dirname, '..');
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ADMIN = { email: 'admin@test.local', name: 'Admin Test', role: 'admin' as const, blocked: false };

test('madeLate: from 13:00 IST on the day (or a later day) counts as late', async () => {
  const { madeLate, GATE_CUTOFF_HOUR_IST } = await import('../lib/trainingGate');
  assert.equal(GATE_CUTOFF_HOUR_IST, 13);
  assert.equal(madeLate('2026-11-20 03:30:00', '2026-11-20'), false); // 09:00 IST
  assert.equal(madeLate('2026-11-20 07:29:00', '2026-11-20'), false); // 12:59 IST
  assert.equal(madeLate('2026-11-20 07:30:00', '2026-11-20'), true); // 13:00 IST
  assert.equal(madeLate('2026-11-20 20:00:00', '2026-11-20'), true); // next day IST
  assert.equal(madeLate(null, '2026-11-20'), false);
});

test('every role can reach the training (no action needed); the calendar button sends no ticks', async () => {
  const { actionFor } = await import('../lib/permissions');
  assert.equal(actionFor('POST', '/api/associate-training'), null);
  assert.equal(actionFor('GET', '/api/associate-training'), null);
  const src = fs.readFileSync(path.join(ROOT, 'components/shared/publish-checklist.tsx'), 'utf8');
  assert.match(src, /onConfirm: \(\) => void/);
  assert.doesNotMatch(src, /onConfirm\(ALL_TICKED\)/);
  for (const f of ['components/tabs/home-tab.tsx', 'components/tabs/strategy-tab.tsx', 'components/shared/blog-move-controls.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /[{,]\s*checklist\b/, f);
  // The calendar slot never makes a different banner for a blog approved with a banner tick.
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/strategy/autopilot.ts'), 'utf8'), /The banner checked at approval is missing/);
  // While locked, Associate Training opens whatever the role's page access.
  assert.match(fs.readFileSync(path.join(ROOT, 'components/dashboard.tsx'), 'utf8'), /\(locked && key === 'associates'\)/);
});

test('the gate: version-1 rows never lock, late rows do not lock that day, blocked people are never locked', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { trainingGate, forgetGate } = await import('../lib/trainingGate');
  const email = `gate-${stamp()}@test.local`;
  const day = '2042-03-12';
  const lessons: number[] = [];
  const mk = async (extras: string | null, created: string, track: string) => {
    const l = await prisma.training_lessons.create({ data: { day, level: 4, track, audience: 'associate', title: `${track} lesson`, content_html: '<p>x</p>', questions: '[]', extras, created_at: created } });
    lessons.push(l.id);
    return l.id;
  };
  try {
    await prisma.team_members.create({ data: { email, name: 'Gate Test', role: 'user' } });
    // The day this version goes live: today's old lesson and old open test.
    const v1 = await mk(null, '2042-03-12 03:30:00', 'technical');
    await prisma.training_profiles.create({ data: { email, name: 'Gate Test', lesson_id: v1 } });
    await prisma.training_tests.create({ data: { email, day, level: 1, questions: '[]', total: 1, status: 'open', created_at: '2042-03-12 03:30:00' } });
    let g = await trainingGate(email, 'user', day);
    assert.equal(g.locked, false, 'version-1 rows never lock');

    // Lessons made late (AI paused until the afternoon): told, not locked.
    const late = await mk('{}', '2042-03-12 09:00:00', 'uic');
    await prisma.training_profiles.update({ where: { email }, data: { lesson_ids: JSON.stringify({ uic: late }) } });
    forgetGate(email);
    g = await trainingGate(email, 'user', day);
    assert.equal(g.locked, false);
    assert.match(g.notice!, /ready late \(after 13:00 IST\)/);

    // Made on time: locked; blocked: never.
    const onTime = await mk('{}', '2042-03-12 03:40:00', 'marketing');
    await prisma.training_profiles.update({ where: { email }, data: { lesson_ids: JSON.stringify({ uic: late, marketing: onTime }) } });
    forgetGate(email);
    g = await trainingGate(email, 'user', day);
    assert.equal(g.locked, true);
    assert.deepEqual(g.unread.map((u: any) => u.id), [onTime]);
    await prisma.team_members.update({ where: { email }, data: { blocked: true } });
    forgetGate(email);
    assert.equal((await trainingGate(email, 'user', day)).locked, false);

    // A blocked person gets no lessons (no AI call) and no profile on a first visit.
    let asked = 0;
    const { prepareDay } = await import('../lib/associateTraining');
    await prepareDay(email, '2042-03-13', 'user', (async () => {
      asked++;
      throw new Error('should not be asked');
    }) as any);
    assert.equal(asked, 0);
    const other = `blocked-${stamp()}@test.local`;
    const { trainingView } = await import('../lib/associateTrainingView');
    await trainingView({ email: other, name: 'Blocked', role: 'user', blocked: true });
    assert.equal(await prisma.training_profiles.count({ where: { email: other } }), 0);
  } finally {
    await prisma.training_tests.deleteMany({ where: { email } });
    await prisma.training_profiles.deleteMany({ where: { email } });
    await prisma.team_members.deleteMany({ where: { email } });
    await prisma.training_lessons.deleteMany({ where: { id: { in: lessons } } });
    forgetGate();
  }
});

test('a failing lesson is tried at most twice a day in total, and one call at a time per lesson', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const settings = await import('../lib/settings');
  const { makeLesson, MAX_LESSON_FAILURES } = await import('../lib/associateTraining');
  const day = `2043-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
  let calls = 0;
  const failing = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return { text: 'not json at all' };
  }) as any;
  try {
    // Two people at the same moment: one shared make (it tries twice inside).
    const [a, b] = await Promise.allSettled([makeLesson(day, 3, 'marketing', 'associate', failing), makeLesson(day, 3, 'marketing', 'associate', failing)]);
    assert.equal(a.status, 'rejected');
    assert.equal(b.status, 'rejected');
    assert.equal(calls, 2, 'one make, two attempts inside it');
    await makeLesson(day, 3, 'marketing', 'associate', failing).catch(() => {});
    assert.equal(calls, 4);
    assert.equal(MAX_LESSON_FAILURES, 2);
    // Twice failed today: not asked again; the day goes without it (nobody is locked by it).
    assert.equal(await makeLesson(day, 3, 'marketing', 'associate', failing), null);
    assert.equal(calls, 4);
    // AI work waiting (paused, Testing mode) does not count as a failure.
    const { CreditPausedError } = await import('../lib/aiCredits');
    const paused = (async () => {
      throw new CreditPausedError('paused');
    }) as any;
    await assert.rejects(makeLesson(day, 3, 'technical', 'associate', paused), /paused/);
    assert.equal(await settings.get(`training_fail:${day}:3:technical:associate`), null);
  } finally {
    await prisma.settings.deleteMany({ where: { key: { startsWith: `training_fail:${day}` } } });
  }
});

test('the banner is settled before it is ticked, and publishing never makes a different one', { skip: !db, timeout: 90000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { setTicks, checklistState, checklistProblem } = await import('../lib/publishChecklist');
  const { GET } = await import('../app/api/drafts/[id]/checklist/route');
  const kw = await prisma.keywords.create({ data: { keyword: `banner ${stamp()}`, status: 'drafted' } });
  const live = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Live post with no author', content_html: '<p>x</p>', status: 'published', wp_post_url: 'https://x/insights/a/' } });
  const d = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'Banner test', content_html: '<p>Some words here.</p>', status: 'pending_review', author: 'Harsh Jain' } });
  try {
    // Opening the checklist makes the banner (the branded cover here: no photo source in tests).
    const res = await GET(new Request(`http://x/api/drafts/${d.id}/checklist`) as any, { params: Promise.resolve({ id: String(d.id) }) });
    const st = await res.json();
    const saved = (await prisma.drafts.findUnique({ where: { id: d.id } })).featured_image_path;
    assert.ok(saved, 'a banner file is saved on the draft');
    assert.equal(st.values.bannerReady, true);
    await setTicks(d.id, { author: true, title: true, content: true, banner: true }, 'Reviewer');
    assert.equal(await checklistProblem(d.id, null, 'x'), null);
    // The banner file changes: the tick goes, and nothing re-makes the banner behind it.
    await prisma.drafts.update({ where: { id: d.id }, data: { featured_image_path: 'covers/other.png' } });
    assert.match((await checklistProblem(d.id, null, 'x'))!, /Banner checked/);
    // A live post with no author: the default author is what is checked, and can be ticked.
    const ls = await checklistState(live);
    assert.equal(ls.values.live, true);
    assert.equal(ls.values.author, null);
    const t = await setTicks(live.id, { author: true }, 'Reviewer');
    assert.equal(t.items.find((i: any) => i.key === 'author')?.ticked, true);
    // publishDraft: the old path that made a new banner at publish time is gone.
    const src = fs.readFileSync(path.join(ROOT, 'lib/publishDraft.ts'), 'utf8');
    assert.doesNotMatch(src, /ensurePhotoCover|makeCover\(/);
    assert.match(src, /The banner that was checked is missing/);
    void ADMIN;
  } finally {
    await prisma.drafts.deleteMany({ where: { id: { in: [d.id, live.id] } } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

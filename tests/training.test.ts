// Team training: the curriculum and prompts (official sources, never invent; Know UIC from our own
// website only), adaptive levels, the weekly surprise test, games and slides built from the lesson,
// YouTube-only videos, the team report, and the daily gate that locks the dashboard (pages and API
// writes) until today's lessons are read and today's tests are submitted, failing open when nothing
// was made. No AI call reaches the API: lessons come from a stub. Database tests use DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
for (const k of ['SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET', 'FIREFLIES_API_KEY']) delete process.env[k];
globalThis.fetch = (async (url: any) => {
  throw new Error(`Network call in a test: ${String(url)}`);
}) as any;

const content = () => import('../lib/trainingContent');
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const LESSON_EXTRAS = {
  terms: [
    { term: 'FBAR', definition: 'FinCEN Form 114, reports foreign financial accounts' },
    { term: 'Form 8938', definition: 'FATCA statement of specified foreign financial assets' },
    { term: 'ITIN', definition: 'IRS tax number for people who cannot get an SSN' },
    { term: 'W-8BEN', definition: 'Form a foreign individual gives to a US payer' },
  ],
  steps: { title: 'Getting an ITIN', items: ['Collect documents', 'Fill Form W-7', 'Attach the tax return', 'Send to the IRS'] },
  cases: [{ scenario: 'An NRI with a US brokerage account asks which form a US payer needs from him.', options: ['W-9', 'W-8BEN', 'W-8BEN-E'], answer: 1, explain: 'A foreign individual gives W-8BEN.' }],
  blanks: [{ sentence: 'An ITIN is applied for on Form ___.', answer: 'W-7', options: ['W-7', 'SS-4', 'W-9'] }],
  slides: [{ heading: 'What an FBAR is', points: ['FinCEN Form 114', 'Foreign accounts'] }],
  videos: [
    { title: 'IRS on ITIN', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', channel: 'IRSvideos' },
    { title: 'Bad', url: 'https://vimeo.com/123' },
    { title: 'Short link', url: 'https://youtu.be/abcdefghijk' },
    { title: 'Third', url: 'https://www.youtube.com/embed/ZZZZZZZZZZZ' },
  ],
};

test('three questions per lesson at every level, and the tracks are three', async () => {
  const { LEVELS, questionsFor, TRACKS } = await content();
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((l) => LEVELS[l].questions === 3));
  assert.deepEqual(TRACKS, ['technical', 'uic', 'marketing']);
  assert.ok(questionsFor('marketing', 12) === 3 && questionsFor('technical', 1) === 3 && questionsFor('uic', 1) === 3);
});

test('the prompts carry the curriculum, the marketing use, Know UIC and the official-source rule', async () => {
  const { lessonPrompt, systemPrompt, LEVELS } = await content();
  const sys = systemPrompt('GOAL');
  assert.match(sys, /OFFICIAL source/);
  assert.match(sys, /Never invent a figure, rate, threshold, date, deadline, form number, price or section number/);
  assert.match(sys, /irs\.gov/);
  assert.match(sys, /incometax\.gov\.in/);
  assert.match(sys, /rbi\.org\.in/);
  const tech = lessonPrompt({ day: '2026-11-20', level: 1, track: 'technical', audience: 'associate', earlier: [] });
  for (const w of ['US taxation to CPA level', 'What it is', 'Deadlines, government fees and penalties', 'Recently changed', 'Example', 'Using it in marketing and offers']) assert.ok(tech.includes(w), w);
  assert.ok(tech.includes(LEVELS[1].depth) && /Basic/.test(tech));
  assert.match(tech, /Scenario-based multiple choice/);
  assert.match(tech, /ONE correct/);
  assert.match(tech, /plausible/);
  assert.match(tech, /"source": the official URL/);
  const l5 = lessonPrompt({ day: '2026-11-20', level: 5, track: 'technical', audience: 'associate', earlier: [] });
  assert.match(l5, /exceptions/);
  const mkt = lessonPrompt({ day: '2026-11-20', level: 2, track: 'marketing', audience: 'associate', earlier: [] });
  for (const w of ['blog angles', 'LinkedIn post', 'FAQs', 'lead questions', 'compliance-safe', 'SEO', 'AEO/GEO']) assert.ok(mkt.includes(w), w);
  const cat = { builtAt: 'x', services: [{ name: 'ITIN application', url: 'https://usaindiacfo.com/services/itin', summary: 'We are a Certifying Acceptance Agent.', source: 's', posts: ['ITIN guide'] }], process: [{ title: 'How we work', url: 'https://usaindiacfo.com/how-we-work', text: 'Discovery call, proposal, onboarding.' }], sources: [] };
  const uic = lessonPrompt({ day: '2026-11-20', level: 3, track: 'uic', audience: 'manager', earlier: [], catalogue: cat, service: cat.services[0] });
  for (const w of ['KNOW UIC', 'every service it offers', 'rules and regulations', 'ITIN application', 'https://usaindiacfo.com/services/itin', 'How we work', 'Discovery call', 'step by step', '"skip":true', 'official sources']) assert.ok(uic.includes(w), w);
  assert.match(uic, /pricing conversations without quoting any price that is not published/);
  assert.match(uic, /compliance limits/);
  const noCat = lessonPrompt({ day: '2026-11-20', level: 1, track: 'uic', audience: 'associate', earlier: [], catalogue: { builtAt: 'x', services: [], process: [], sources: [] } });
  assert.match(noCat, /limited to usaindiacfo\.com/);
});

test('videos: YouTube embeds only, checked ids, at most two, never auto-play', async () => {
  const { youtubeId, cleanVideos } = await content();
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(youtubeId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('javascript:alert(1)'), null);
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXc"><script>'), null);
  const v = cleanVideos(LESSON_EXTRAS.videos);
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((x) => x.embed), ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0', 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0']);
  assert.ok(v.every((x) => !/autoplay/.test(x.embed)));
});

test('games and slides are built from the lesson, never from its test questions', async () => {
  const { buildGames, scoreGame, buildSlides, POINTS } = await content();
  const questions = JSON.stringify([{ id: 'q1', q: 'SECRET TEST QUESTION', options: ['a', 'b'], answer: 0, explain: '' }]);
  const g = buildGames({ id: 42, extras: LESSON_EXTRAS, questions });
  assert.doesNotMatch(JSON.stringify(g), /SECRET TEST QUESTION/);
  assert.equal(g.match!.terms.length, 4);
  g.match!.terms.forEach((t, i) => assert.equal(g.match!.definitions[g.match!.answer[i]], LESSON_EXTRAS.terms.find((x) => x.term === t)!.definition));
  assert.deepEqual(g.order!.answer.map((k) => g.order!.shuffled[k]), LESSON_EXTRAS.steps.items);
  assert.notDeepEqual(g.order!.shuffled, LESSON_EXTRAS.steps.items, 'the steps start out of order');
  assert.equal(g.blanks[0].options[g.blanks[0].answer], 'W-7');
  assert.equal(g.cases[0].answer, 1);
  assert.equal(g.lightning.length, 4);
  assert.deepEqual(buildGames({ id: 42, extras: LESSON_EXTRAS }), g, 'the same game for everyone');
  const all = scoreGame(g, { match: g.match!.answer, order: g.order!.answer, cases: [1], blanks: [g.blanks[0].answer], lightning: g.lightning.map((x) => x.answer), seconds: 30 });
  assert.equal(all.points, all.max);
  assert.equal(all.max, 4 * POINTS.match + POINTS.order + POINTS.cases + POINTS.blanks + 4 * (POINTS.lightning + 1));
  const none = scoreGame(g, {});
  assert.equal(none.points, 0);
  const slow = scoreGame(g, { lightning: g.lightning.map((x) => x.answer), seconds: 200 });
  assert.equal(slow.points, 4 * POINTS.lightning, 'no speed bonus after 60 seconds');
  const slides = buildSlides({ title: 'FBAR basics', content_html: '<h3>A</h3><p>x</p>', extras: LESSON_EXTRAS });
  assert.equal(slides[0].heading, 'FBAR basics');
  assert.equal(slides[1].heading, 'What an FBAR is');
  assert.deepEqual(slides[slides.length - 1].flow, LESSON_EXTRAS.steps.items);
  const fromHtml = buildSlides({ title: 'T', content_html: '<h3>Who files</h3><ul><li>US persons</li><li>Over the threshold</li></ul><h3>When</h3><p>Every year. With the return.</p>' });
  assert.deepEqual(fromHtml.slice(1).map((s) => s.heading), ['Who files', 'When']);
  assert.deepEqual(fromHtml[1].points, ['US persons', 'Over the threshold']);
});

test('levels adapt: up on a high average without a falling trend, down after repeated low scores', async () => {
  const { adaptiveLevel, UP_AVG, DOWN_AVG } = await import('../lib/associateTraining');
  assert.equal(UP_AVG, 80);
  assert.equal(DOWN_AVG, 50);
  assert.equal(adaptiveLevel(2, [90]).level, 2, 'one test is not enough');
  assert.equal(adaptiveLevel(2, [90, 85, 80]).level, 3);
  assert.match(adaptiveLevel(2, [90, 85, 80]).reason!, /80% moves up/);
  assert.equal(adaptiveLevel(2, [70, 95, 100]).level, 2, 'a falling trend does not move up');
  assert.equal(adaptiveLevel(12, [100, 100, 100]).level, 12);
  assert.equal(adaptiveLevel(3, [40, 30, 50]).level, 2);
  assert.equal(adaptiveLevel(3, [40, 30]).level, 3, 'down needs three tests');
  assert.equal(adaptiveLevel(1, [0, 0, 0]).level, 1);
  assert.equal(adaptiveLevel(3, [60, 70, 65]).level, 3);
});

test('the surprise test comes on one unannounced weekday a week, the same for a person all week', async () => {
  const { surpriseWeekday, isSurpriseDay, weekStart } = await import('../lib/associateTraining');
  assert.equal(weekStart('2026-11-20'), '2026-11-16');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  const seen = new Set<number>();
  for (const email of ['a@x', 'b@x', 'c@x', 'd@x', 'e@x', 'f@x', 'g@x', 'h@x']) {
    for (const monday of ['2026-11-16', '2026-11-23', '2026-11-30']) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((n) => new Date(Date.parse(`${monday}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10));
      const hits = days.filter((d) => isSurpriseDay(email, d, 'secret'));
      assert.equal(hits.length, 1, `${email} ${monday}`);
      const dow = new Date(`${hits[0]}T00:00:00Z`).getUTCDay();
      assert.ok(dow >= 1 && dow <= 5, 'a weekday');
      seen.add(surpriseWeekday(email, monday, 'secret'));
      assert.equal(surpriseWeekday(email, days[4], 'secret'), surpriseWeekday(email, monday, 'secret'));
    }
  }
  assert.ok(seen.size >= 3, 'different days for different people and weeks');
});

test('the Know UIC catalogue is built only from our own site sources', async () => {
  const { buildCatalogue, serviceForDay } = await import('../lib/uicCatalogue');
  const cat = await buildCatalogue({
    pages: async () => [
      { slug: '/services/itin-application', title: 'ITIN Application', meta_description: 'Certifying Acceptance Agent for ITIN.', sections: JSON.stringify({ hero: { heading: 'ITIN without mailing your passport', html: '<p>We review your W-7.</p>' } }), html: null },
      { slug: '/services/us-company-formation', title: 'US Company Formation', meta_description: 'LLC and C-Corp for Indian founders.', sections: null, html: null },
      { slug: '/services', title: 'All services', meta_description: '', sections: null, html: null },
      { slug: '/blog/x', title: 'Some blog', meta_description: '', sections: null, html: null },
      { slug: '/how-we-work', title: 'How we work', meta_description: 'Discovery call, scope, onboarding.', sections: null, html: null },
    ],
    ctas: async () => JSON.stringify([
      { service: 'Virtual CFO', match: 'cfo', text: 'See how our virtual CFO team works.', url: 'https://usaindiacfo.com/contact-us/' },
      { service: 'Made-up service', match: 'x', text: 'x', url: 'https://other-site.com/x' },
      { service: 'ITIN application', match: 'itin', text: 'dup', url: 'https://usaindiacfo.com/contact-us/' },
    ]),
    posts: async () => [{ title: 'ITIN for NRIs: the W-7 explained', link: 'https://usaindiacfo.com/insights/itin/' }],
  });
  assert.deepEqual(cat.services.map((s) => s.name), ['ITIN Application', 'US Company Formation', 'Virtual CFO']);
  assert.ok(cat.services.every((s) => /^https:\/\/usaindiacfo\.com\//.test(s.url)));
  assert.match(cat.services[0].summary, /Certifying Acceptance Agent.*W-7/);
  assert.deepEqual(cat.services[0].posts, ['ITIN for NRIs: the W-7 explained']);
  assert.deepEqual(cat.process.map((p) => p.title), ['How we work']);
  assert.ok(!JSON.stringify(cat).includes('Made-up service'));
  // The services take turns, day by day.
  const names = new Set(['2026-11-20', '2026-11-21', '2026-11-22'].map((d) => serviceForDay(cat, d)!.name));
  assert.equal(names.size, 3);
  assert.equal(serviceForDay({ ...cat, services: [] }, '2026-11-20'), null);
  const empty = await buildCatalogue({ pages: async () => [], ctas: async () => null, posts: async () => { throw new Error('site down'); } });
  assert.deepEqual(empty.services, []);
});

test('the team report CSV is safe to open in a spreadsheet', async () => {
  const { reportCsv } = await import('../lib/associateTrainingView');
  const csv = reportCsv([{ email: 'a@x', name: '=HYPERLINK("x")', role: 'user', level: 2, active: true, tests: 3, average: 80, trend: 5, streak: 1, points: 40, gameStreak: 2, badge: 'Getting started', tracks: { technical: 80, uic: 70, marketing: null }, strengths: ['FBAR (90%)'], weak: ['PFIC (40%)'], surprise: [{ day: '2026-11-18', percent: 75, status: 'done' }], series: [{ day: '2026-11-18', percent: 75, kind: 'surprise', status: 'done' }], levels: [{ at: '2026-11-17 10:00:00', from: 1, to: 2, reason: 'x' }], last: null, dueAgain: 0 }]);
  const [head, row] = csv.trim().split('\n');
  assert.match(head, /^Name,Email,Role,Level/);
  assert.match(row, /^"'=HYPERLINK\(""x""\)",a@x,user,2,yes,3,80,5/);
  assert.match(row, /PFIC \(40%\)/);
  assert.match(row, /2026-11-17 1->2/);
});

// A lesson as the stubbed AI writes it, for each track.
function fakeAsk(calls: string[]) {
  return async (_system: string, messages: any[]) => {
    const prompt = String(messages[0].content);
    calls.push(prompt);
    const track = /Track: (Technical knowledge|Know UIC|Marketing skills)/.exec(prompt)![1];
    const q = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `${track} question ${i + 1}?`, options: ['Right', 'Wrong 1', 'Wrong 2', 'Wrong 3'], answer: 0, explain: 'Because.', source: 'https://www.irs.gov/x' }));
    const n = Number(/Then write (\d+) questions/.exec(prompt)![1]);
    return { text: `===JSON===${JSON.stringify({ title: `${track} lesson`, topic: `${track} topic`, content_html: '<h3>Part</h3><p>Text.</p>', sources: [{ title: 'IRS', url: 'https://www.irs.gov/x' }], questions: q(n), ...LESSON_EXTRAS })}===END===` };
  };
}
const randomWednesday = () => {
  const base = Date.UTC(2041, 0, 2) + Math.floor(Math.random() * 3000) * 7 * 86400000; // 2041-01-02 is a Wednesday
  return new Date(base).toISOString().slice(0, 10);
};

test('the daily gate: locks pages and API writes until lessons are read and tests submitted; fails open; not for the admin', { skip: !db, timeout: 120000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { prepareDay, markRead, submitTest } = await import('../lib/associateTraining');
  const { trainingGate, gateRefusal, forgetGate } = await import('../lib/trainingGate');
  const assoc = `assoc-${stamp()}@test.local`;
  const mgr = `mgr-${stamp()}@test.local`;
  const day = randomWednesday();
  const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const calls: string[] = [];
  await prisma.training_profiles.create({ data: { email: assoc, name: 'Assoc' } });
  await prisma.training_profiles.create({ data: { email: mgr, name: 'Mgr' } });
  // This test checks the daily gate with a lesson and a test every day, so turn the weekly pattern off.
  await (await import('../lib/settings')).set('training_pattern_start', '');
  try {
    // Nothing made for today (Testing mode, paused AI, a failed run): open, with a notice.
    const failing = async () => {
      throw new Error('AI work is paused');
    };
    await prepareDay(assoc, day, 'user', failing as any).catch(() => {});
    let gate = await trainingGate(assoc, 'user', day);
    assert.equal(gate.locked, false);
    assert.match(gate.notice!, /not ready yet/);

    // Lessons made: the associate gets three associate lessons, the manager three manager lessons.
    await prepareDay(assoc, yesterday, 'user', fakeAsk(calls) as any);
    await prepareDay(mgr, yesterday, 'manager', fakeAsk(calls) as any);
    const mine = await prisma.training_lessons.findMany({ where: { day: yesterday, level: 1 }, orderBy: [{ audience: 'asc' }, { track: 'asc' }] });
    assert.deepEqual(mine.map((l: any) => `${l.audience}:${l.track}`), ['associate:marketing', 'associate:technical', 'associate:uic', 'manager:marketing', 'manager:technical', 'manager:uic']);
    assert.equal(calls.length, 6, 'one call per track, level and audience');
    assert.ok(calls.filter((c) => /Track: Know UIC/.test(c) && /Manager level/.test(c)).length === 1);
    // Shared: a second associate at the same level does not make new lessons.
    const other = `assoc2-${stamp()}@test.local`;
    await prisma.training_profiles.create({ data: { email: other, name: 'Other' } });
    await prepareDay(other, yesterday, 'user', fakeAsk(calls) as any);
    assert.equal(calls.length, 6);
    await prisma.training_profiles.deleteMany({ where: { email: other } });

    // Today: a test on yesterday's lessons and three new lessons.
    await prepareDay(assoc, day, 'user', fakeAsk(calls) as any);
    forgetGate(assoc);
    gate = await trainingGate(assoc, 'user', day);
    assert.equal(gate.locked, true);
    assert.equal(gate.unread.length, 3);
    assert.equal(gate.openTests.filter((t) => t.kind === 'daily').length, 1);
    const testRow = await prisma.training_tests.findFirst({ where: { email: assoc, day, kind: 'daily' } });
    assert.equal(testRow.total, 3 + 3 + 3, 'questions from the three lessons of yesterday');

    // The proxy refuses API writes outside the training, keeps reads and the training itself open.
    const refused = await gateRefusal('POST', '/api/drafts/5', assoc, 'user', day);
    assert.equal(refused!.status, 403);
    assert.match(refused!.body.error, /Finish today's training to open the dashboard/);
    assert.equal(await gateRefusal('GET', '/api/drafts', assoc, 'user', day), null);
    assert.equal(await gateRefusal('POST', '/api/associate-training', assoc, 'user', day), null);
    // The admin never; a manager in training is gated too (their own lessons).
    assert.equal(await gateRefusal('POST', '/api/drafts/5', 'admin@x', 'admin', day), null);
    await prepareDay(mgr, day, 'manager', fakeAsk(calls) as any);
    forgetGate(mgr);
    assert.equal((await trainingGate(mgr, 'manager', day)).locked, true);

    // Read every lesson: still locked by the open test. Submit it: unlocked.
    const p = await prisma.training_profiles.findUnique({ where: { email: assoc } });
    for (const id of Object.values(JSON.parse(p.lesson_ids)) as number[]) await markRead(assoc, id);
    const reads = await prisma.training_reads.findMany({ where: { email: assoc } });
    assert.equal(reads.length, 3);
    assert.ok(reads.every((r: any) => r.read_at));
    gate = await trainingGate(assoc, 'user', day);
    assert.equal(gate.unread.length, 0);
    assert.equal(gate.locked, true);
    await assert.rejects(markRead(assoc, 999999999), /not one of your lessons/);
    const answers = Object.fromEntries(JSON.parse(testRow.questions).map((q: any) => [q.id, q.answer]));
    const res = await submitTest(assoc, testRow.id, answers);
    assert.equal(res.percent, 100);
    // On the person's surprise day a surprise test is open too: still locked until it is submitted.
    const surprise = await prisma.training_tests.findFirst({ where: { email: assoc, day, kind: 'surprise', status: 'open' } });
    if (surprise) {
      assert.equal((await trainingGate(assoc, 'user', day)).locked, true);
      await submitTest(assoc, surprise.id, {});
    }
    gate = await trainingGate(assoc, 'user', day);
    assert.equal(gate.locked, false);
    assert.equal(await gateRefusal('POST', '/api/drafts/5', assoc, 'user', day), null);

    // The admin pausing a person (active = false) removes the gate.
    forgetGate(mgr);
    await prisma.training_profiles.update({ where: { email: mgr }, data: { active: false } });
    assert.equal((await trainingGate(mgr, 'manager', day)).locked, false);
  } finally {
    await prisma.training_reads.deleteMany({ where: { email: { in: [assoc, mgr] } } });
    await prisma.training_tests.deleteMany({ where: { email: { in: [assoc, mgr] } } });
    await prisma.training_misses.deleteMany({ where: { email: { in: [assoc, mgr] } } });
    await prisma.training_level_history.deleteMany({ where: { email: { in: [assoc, mgr] } } });
    await prisma.training_profiles.deleteMany({ where: { email: { in: [assoc, mgr] } } });
    await prisma.training_lessons.deleteMany({ where: { day: { in: [day, yesterday] } } });
    forgetGate();
  }
});

test('scores move the level up and down with history; surprise test, games and the team report', { skip: !db, timeout: 120000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { submitTest, prepareSurprise, playGame, setLevel } = await import('../lib/associateTraining');
  const { teamReport } = await import('../lib/associateTrainingView');
  const email = `lvl-${stamp()}@test.local`;
  const day = randomWednesday();
  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
  await prisma.training_profiles.create({ data: { email, name: 'Level Test', level: 2 } });
  const q = (id: string, track: string, topic: string) => ({ id, q: `${id}?`, options: ['a', 'b', 'c', 'd'], answer: 0, explain: '', track, topic });
  const lessons: number[] = [];
  try {
    const mk = async (d: string, n: number, score: number) => {
      const qs = Array.from({ length: n }, (_, i) => q(`${email}-${d}-${i}`, i % 2 ? 'marketing' : 'technical', i % 2 ? 'LinkedIn posts' : 'FBAR'));
      const level = (await prisma.training_profiles.findUnique({ where: { email } })).level;
      const t = await prisma.training_tests.create({ data: { email, day: d, level, questions: JSON.stringify(qs), total: n } });
      const answers = Object.fromEntries(qs.map((x, i) => [x.id, i < score ? 0 : 1]));
      return submitTest(email, t.id, answers);
    };
    const r1 = await mk('2040-01-01', 10, 9);
    assert.equal(r1.levelUp, false);
    const r2 = await mk('2040-01-02', 10, 10);
    assert.equal(r2.levelUp, true);
    let p = await prisma.training_profiles.findUnique({ where: { email } });
    assert.equal(p.level, 3);
    // Three low scores at the new level move it back down.
    await mk('2040-01-03', 10, 3);
    await mk('2040-01-04', 10, 2);
    const down = await mk('2040-01-05', 10, 4);
    assert.equal(down.levelDown, true);
    p = await prisma.training_profiles.findUnique({ where: { email } });
    assert.equal(p.level, 2);
    const hist = await prisma.training_level_history.findMany({ where: { email }, orderBy: { id: 'asc' } });
    assert.deepEqual(hist.map((h: any) => `${h.from_level}->${h.to_level}`), ['2->3', '3->2']);
    await setLevel(email, 4, 'set by Admin', 'Admin');
    assert.equal((await prisma.training_level_history.count({ where: { email } })), 3);
    await setLevel(email, 2, 'back', 'Admin');

    // Surprise test: from this week's lessons at the person's level and audience, once a week.
    for (const track of ['technical', 'uic', 'marketing']) {
      const l = await prisma.training_lessons.create({ data: { day: monday, level: 2, track, audience: 'associate', title: `${track} lesson`, content_html: '<p>x</p>', questions: JSON.stringify([q(`wk-${email}-${track}-1`, track, `${track} topic`), q(`wk-${email}-${track}-2`, track, `${track} topic`)]), extras: JSON.stringify(LESSON_EXTRAS) } });
      lessons.push(l.id);
    }
    const s = await prepareSurprise(email, day, 2, 'associate');
    assert.ok(s);
    assert.equal(s.kind, 'surprise');
    assert.equal(s.total, 6);
    assert.ok(JSON.parse(s.questions).every((x: any) => x.id.startsWith('s-wk-')));
    assert.equal(await prepareSurprise(email, day, 2, 'associate'), null, 'once a week');
    await submitTest(email, s.id, {});

    // A game round on a lesson: marked on the server, the best round kept, points added once.
    const { buildGames } = await content();
    const g = buildGames({ id: lessons[0], extras: LESSON_EXTRAS });
    // A lesson that is not the person's own lesson of today is practice: no points kept.
    const practice = await playGame(email, lessons[0], { match: g.match!.answer });
    assert.equal(practice.awarded, false);
    assert.equal(await prisma.training_games.count({ where: { email } }), 0);
    // Made the person's own lesson of today: points count.
    const { istDay } = await import('../lib/topics');
    await prisma.training_lessons.update({ where: { id: lessons[0] }, data: { day: istDay() } });
    await prisma.training_profiles.update({ where: { email }, data: { lesson_ids: JSON.stringify({ technical: lessons[0] }) } });
    const first = await playGame(email, lessons[0], { match: g.match!.answer });
    assert.equal(first.points, 4 * 10);
    const again = await playGame(email, lessons[0], { match: g.match!.answer, order: g.order!.answer });
    assert.equal(again.points, 60);
    assert.equal(again.totalPoints, 60);
    assert.equal(again.streak, 1);
    const worse = await playGame(email, lessons[0], {});
    assert.equal(worse.best, 60);
    assert.equal(worse.totalPoints, 60);

    // The report: marks over time, trend, level history, per track, strengths and weak topics, surprise.
    const row = (await teamReport()).find((r) => r.email === email)!;
    assert.ok(row);
    assert.equal(row.tests, 6);
    assert.equal(row.series.length, 6);
    assert.equal(row.series[0].day, '2040-01-01', 'oldest first');
    assert.equal(row.surprise.length, 1);
    assert.equal(row.surprise[0].percent, 0);
    assert.ok(row.levels.length >= 4);
    assert.ok(row.tracks.technical !== null && row.tracks.marketing !== null);
    assert.ok(typeof row.average === 'number');
    assert.equal(row.points, 60);
    assert.ok(row.weak.length + row.strengths.length > 0);
  } finally {
    await prisma.training_games.deleteMany({ where: { email } });
    await prisma.training_tests.deleteMany({ where: { email } });
    await prisma.training_misses.deleteMany({ where: { email } });
    await prisma.training_level_history.deleteMany({ where: { email } });
    await prisma.training_profiles.deleteMany({ where: { email } });
    await prisma.training_lessons.deleteMany({ where: { id: { in: lessons } } });
  }
});

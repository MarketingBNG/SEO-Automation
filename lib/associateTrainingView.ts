// Team Training as its page shows it. Everyone but the admin gets their own training (three
// lessons a day, tests, games, the Watch area). The admin and managers also get the team report:
// per person marks, trend, level history, strengths and weak topics per track, streaks, surprise
// tests (sortable on the page, downloadable as CSV). Shared by GET /api/associate-training and the
// assistant's training_status. Taking a test stays on the page.
import prismaClient from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { istDay } from '@/lib/topics';
import { DOWN_AVG, LEVELS, PASS_PERCENT, UP_AVG, WINDOW, gameStreak, isTrainee, lessonIdsOf, testQuestions, type Question } from '@/lib/associateTraining';
import { TRACKS, TRACK_LABEL, audienceFor, badgeFor, buildGames, buildSlides, type Track } from '@/lib/trainingContent';
import { trainingGate } from '@/lib/trainingGate';

// Untyped on purpose: the Prisma query types of these many queries push the build's type check past
// its memory limit (see lib/assistant/tabTools.ts). The tests cover the queries.
const prisma: any = prismaClient;

export const pct = (t: { score: number | null; total: number }) => Math.round(((t.score || 0) / Math.max(1, t.total)) * 100);
// Questions as the page may see them before the test is done: no answers, no explanations.
const hidden = (qs: Question[]) => qs.map((q) => ({ id: q.id, q: q.q, options: q.options, repeat: Boolean(q.repeat), track: q.track || null }));
const json = (s: string | null | undefined, fallback: any) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

// The admin and managers see the team report. Only the admin does not take the training.
export const isViewer = (role: string) => role === 'admin' || role === 'manager';

// The trainees a viewer may see in the report. The admin sees everyone (null = no limit); a manager
// sees only their own team. A manager with no team set, or whose team no one shares, sees no one.
export async function visibleEmails(me: { email: string; role: string }): Promise<Set<string> | null> {
  if (me.role === 'admin') return null;
  const self = await prisma.team_members.findUnique({ where: { email: me.email }, select: { team: true } });
  if (!self?.team) return new Set<string>();
  const rows = await prisma.team_members.findMany({ where: { team: self.team }, select: { email: true } });
  return new Set<string>(rows.map((r: any) => r.email.toLowerCase()));
}

function lessonOut(l: any, read?: string | null) {
  const extras = json(l.extras, {});
  return {
    id: l.id,
    day: l.day,
    level: l.level,
    track: l.track,
    trackLabel: TRACK_LABEL[l.track as Track] || l.track,
    audience: l.audience,
    topic: l.topic,
    title: l.title,
    content_html: l.content_html,
    sources: json(l.sources, []),
    slides: buildSlides({ title: l.title, content_html: l.content_html, extras }),
    videos: extras.videos || [],
    service: extras.service || null,
    games: buildGames({ id: l.id, extras, questions: l.questions }),
    readAt: read ?? null,
  };
}

// One person's training as their page shows it.
async function personView(email: string, role: string) {
  const profile = await prisma.training_profiles.findUnique({ where: { email } });
  if (!profile) return null;
  const ids = Object.values(lessonIdsOf(profile)).filter((x): x is number => Boolean(x));
  const lessons = ids.length ? await prisma.training_lessons.findMany({ where: { id: { in: ids } } }) : [];
  const reads = await prisma.training_reads.findMany({ where: { email, lesson_id: { in: ids } } });
  const open = await prisma.training_tests.findMany({ where: { email, status: 'open' }, orderBy: [{ day: 'desc' }, { kind: 'asc' }] });
  const results = await prisma.training_tests.findMany({ where: { email, status: { notIn: ['open', 'marking'] } }, orderBy: [{ day: 'desc' }, { id: 'desc' }], take: 30, select: { id: true, day: true, level: true, score: true, total: true, status: true, kind: true } });
  const past = await prisma.training_lessons.findMany({ where: { audience: audienceFor(role), level: { lte: profile.level }, id: { notIn: ids } }, orderBy: [{ day: 'desc' }, { level: 'desc' }], take: 15 });
  const games = await prisma.training_games.findMany({ where: { email }, select: { day: true, lesson_id: true, points: true, max_points: true } });
  const streak = gameStreak(games.map((x) => x.day), istDay());
  return {
    email,
    name: profile.name,
    profile: { level: profile.level, streak: profile.streak, active: profile.active, points: profile.points, gameStreak: streak, badge: badgeFor(profile.points, streak), audience: audienceFor(role) },
    lessons: TRACKS.map((t) => lessons.find((l) => l.track === t)).filter(Boolean).map((l) => ({ ...lessonOut(l, reads.find((r) => r.lesson_id === l!.id)?.read_at), played: games.find((x) => x.lesson_id === l!.id) || null })),
    // The first lesson (technical) for older pages and the assistant.
    lesson: lessons.length ? lessonOut(lessons.find((l) => l.track === 'technical') || lessons[0]) : null,
    tests: open.map((t) => ({ id: t.id, day: t.day, kind: t.kind, total: t.total, questions: hidden(testQuestions(t)) })),
    test: open[0] ? { id: open[0].id, day: open[0].day, kind: open[0].kind, total: open[0].total, questions: hidden(testQuestions(open[0])) } : null,
    results: results.map((r) => ({ ...r, percent: pct(r) })),
    pastLessons: past.map((l) => ({ id: l.id, day: l.day, level: l.level, track: l.track, trackLabel: TRACK_LABEL[l.track as Track] || l.track, title: l.title, content_html: l.content_html, sources: json(l.sources, []) })),
    dueAgain: await prisma.training_misses.count({ where: { email, cleared: false } }),
    levelHistory: await prisma.training_level_history.findMany({ where: { email }, orderBy: { id: 'desc' }, take: 20 }),
    gate: await trainingGate(email, role),
  };
}

// ---------- Team report ----------

export type ReportRow = {
  email: string;
  name: string | null;
  role: string;
  level: number;
  active: boolean;
  tests: number;
  average: number | null; // last 5
  trend: number | null; // last 5 average minus the 5 before
  streak: number;
  points: number;
  gameStreak: number;
  badge: string | null;
  tracks: Record<string, number | null>; // % right per track (last 30 tests)
  strengths: string[];
  weak: string[];
  surprise: { day: string; percent: number; status: string }[];
  series: { day: string; percent: number; kind: string; status: string }[]; // oldest first
  levels: { at: string; from: number; to: number; reason: string | null }[];
  last: { id: number; day: string; percent: number; status: string } | null;
  dueAgain: number;
};

// Per track and per topic: how many questions were answered right, from the stored tests.
export function topicStats(tests: { questions: string; answers: string | null; status: string; id: number }[]) {
  const track: Record<string, { right: number; all: number }> = {};
  const topic: Record<string, { right: number; all: number }> = {};
  for (const t of tests) {
    if (t.status !== 'done') continue;
    const answers = json(t.answers, {});
    for (const q of testQuestions(t)) {
      const right = answers[q.id] !== undefined && Number(answers[q.id]) === q.answer;
      const tr = q.track || 'technical';
      (track[tr] ||= { right: 0, all: 0 }).all++;
      if (right) track[tr].right++;
      if (q.topic) {
        (topic[q.topic] ||= { right: 0, all: 0 }).all++;
        if (right) topic[q.topic].right++;
      }
    }
  }
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, track[t] ? Math.round((track[t].right / track[t].all) * 100) : null]));
  const ranked = Object.entries(topic).filter(([, v]) => v.all >= 2).map(([k, v]) => ({ k, p: Math.round((v.right / v.all) * 100) }));
  return {
    tracks,
    strengths: ranked.filter((r) => r.p >= 80).sort((a, b) => b.p - a.p).slice(0, 3).map((r) => `${r.k} (${r.p}%)`),
    weak: ranked.filter((r) => r.p < 60).sort((a, b) => a.p - b.p).slice(0, 3).map((r) => `${r.k} (${r.p}%)`),
  };
}

// only: the emails a viewer may see (from visibleEmails). null = everyone (the admin).
export async function teamReport(only?: Set<string> | null): Promise<ReportRow[]> {
  const team = await prisma.team_members.findMany({ select: { email: true, role: true } });
  const roleOf = new Map<string, string>(team.map((t: any) => [t.email.toLowerCase(), t.role]));
  const people = (await prisma.training_profiles.findMany({ orderBy: { email: 'asc' } })).filter((p) => isTrainee(roleOf.get(p.email) || 'user') && (!only || only.has(p.email.toLowerCase())));
  const out: ReportRow[] = [];
  for (const p of people) {
    const tests = await prisma.training_tests.findMany({ where: { email: p.email, status: { notIn: ['open', 'marking'] } }, orderBy: [{ day: 'desc' }, { id: 'desc' }], take: 60 });
    const pcts = tests.map((t) => pct(t));
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const a5 = avg(pcts.slice(0, 5));
    const b5 = avg(pcts.slice(5, 10));
    const stats = topicStats(tests.slice(0, 30));
    const games = await prisma.training_games.findMany({ where: { email: p.email }, select: { day: true } });
    const gs = gameStreak(games.map((x) => x.day), istDay());
    out.push({
      email: p.email,
      name: p.name,
      role: roleOf.get(p.email) || 'user',
      level: p.level,
      active: p.active,
      tests: tests.length,
      average: a5,
      trend: a5 !== null && b5 !== null ? a5 - b5 : null,
      streak: p.streak,
      points: p.points,
      gameStreak: gs,
      badge: badgeFor(p.points, gs),
      tracks: stats.tracks,
      strengths: stats.strengths,
      weak: stats.weak,
      surprise: tests.filter((t) => t.kind === 'surprise').map((t) => ({ day: t.day, percent: pct(t), status: t.status })),
      series: tests.slice(0, 30).reverse().map((t) => ({ day: t.day, percent: pct(t), kind: t.kind, status: t.status })),
      levels: (await prisma.training_level_history.findMany({ where: { email: p.email }, orderBy: { id: 'asc' } })).map((h) => ({ at: h.created_at, from: h.from_level, to: h.to_level, reason: h.reason })),
      last: tests[0] ? { id: tests[0].id, day: tests[0].day, percent: pct(tests[0]), status: tests[0].status } : null,
      dueAgain: await prisma.training_misses.count({ where: { email: p.email, cleared: false } }),
    });
  }
  return out;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function reportCsv(rows: ReportRow[]): string {
  const head = ['Name', 'Email', 'Role', 'Level', 'In training', 'Tests', 'Average last 5 (%)', 'Trend (points)', 'Test streak', 'Game points', 'Game streak', 'Badge', 'Technical (%)', 'Know UIC (%)', 'Marketing (%)', 'Strengths', 'Weak topics', 'Surprise tests', 'Level changes', 'Scores (oldest first)'];
  const lines = rows.map((r) =>
    [r.name || '', r.email, r.role, r.level, r.active ? 'yes' : 'paused', r.tests, r.average ?? '', r.trend ?? '', r.streak, r.points, r.gameStreak, r.badge || '', r.tracks.technical ?? '', r.tracks.uic ?? '', r.tracks.marketing ?? '', r.strengths.join('; '), r.weak.join('; '), r.surprise.map((s) => `${s.day} ${s.status === 'missed' ? 'missed' : `${s.percent}%`}`).join('; '), r.levels.map((l) => `${l.at.slice(0, 10)} ${l.from}->${l.to}`).join('; '), r.series.map((s) => `${s.day} ${s.percent}%`).join('; ')]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

// Every lesson's walkthrough and videos, by track and topic (newest first).
async function library(audience: string | null) {
  const rows = await prisma.training_lessons.findMany({ where: audience ? { audience } : {}, orderBy: [{ day: 'desc' }, { level: 'asc' }], take: 200, select: { id: true, day: true, level: true, track: true, audience: true, topic: true, title: true, content_html: true, extras: true } });
  return rows.map((l) => {
    const extras = json(l.extras, {});
    return { id: l.id, day: l.day, level: l.level, track: l.track, trackLabel: TRACK_LABEL[l.track as Track] || l.track, audience: l.audience, topic: l.topic || l.title, title: l.title, videos: extras.videos || [], slides: buildSlides({ title: l.title, content_html: l.content_html, extras }) };
  });
}

export async function trainingView(me: { email: string; name: string; role: string; blocked?: boolean }, { testId = 0, person = '' }: { testId?: number; person?: string } = {}): Promise<{ status: number; body: any }> {
  const viewer = isViewer(me.role);
  // A manager is limited to their own team; the admin sees everyone (only = null).
  const only = viewer ? await visibleEmails(me) : new Set<string>();
  if (testId) {
    const t = await prisma.training_tests.findUnique({ where: { id: testId } });
    const canSee = t && (t.email === me.email || (viewer && (!only || only.has(String(t.email).toLowerCase()))));
    if (!canSee) return { status: 404, body: { error: 'Test not found' } };
    // 'marking' is unfinished too (it can go back to 'open', or stay there after a restart until the
    // next day): its answer key is not shown yet.
    if (t.status === 'open' || t.status === 'marking') return { status: 409, body: { error: 'Finish the test first' } };
    return { status: 200, body: { test: { ...t, questions: testQuestions(t), answers: json(t.answers, {}), percent: pct(t) } } };
  }
  const trainee = isTrainee(me.role);
  const catalogue = json(await settings.get('uic_catalogue'), null);
  const base = { today: istDay(), passPercent: PASS_PERCENT, thresholds: { up: UP_AVG, down: DOWN_AVG, window: WINDOW }, levels: LEVELS, viewer, trainee, canManage: me.role === 'admin', catalogue };

  let mine: Awaited<ReturnType<typeof personView>> = null;
  if (trainee) {
    // A blocked person gets no profile and no lessons (no AI spent for someone who cannot take part).
    if (!me.blocked && !(await prisma.training_profiles.findUnique({ where: { email: me.email } }))) {
      await prisma.training_profiles.create({ data: { email: me.email, name: me.name } }).catch(() => {});
      // First visit: make today's lessons now, in the background.
      const { prepareDay } = await import('@/lib/associateTraining');
      void prepareDay(me.email, istDay(), me.role).catch(() => {});
    }
    mine = await personView(me.email, me.role);
  }
  const lib = await library(me.role === 'admin' ? null : audienceFor(me.role));
  if (!viewer) return { status: 200, body: { ...base, me: mine, library: lib } };

  const report = await teamReport(only);
  const roleOf = new Map<string, string>(report.map((r) => [r.email, r.role]));
  const todayLessons = await prisma.training_lessons.findMany({ where: { day: istDay() }, orderBy: [{ audience: 'asc' }, { level: 'asc' }, { track: 'asc' }] });
  let lastRun: any = null;
  try {
    lastRun = JSON.parse((await settings.get('training_last_run')) || 'null');
  } catch {}
  return {
    status: 200,
    body: {
      ...base,
      me: mine,
      library: lib,
      report,
      // Older page shape.
      everyone: report.map((r) => ({ email: r.email, name: r.name, level: r.level, active: r.active, streak: r.streak, tests: r.tests, average: r.average, last: r.last, dueAgain: r.dueAgain })),
      todayLessons: todayLessons.map((l) => lessonOut(l)),
      person: person && roleOf.has(person) ? await personView(person, roleOf.get(person)!) : null,
      lastRun,
    },
  };
}

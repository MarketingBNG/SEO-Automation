// Associate Training as its page shows it. An associate gets their own training; an admin or
// manager gets today's lessons for every level and everyone's progress (person: that person's page;
// testId: one finished test with its answers). Shared by GET /api/associate-training and the
// assistant's training_status. Taking a test stays on the page.
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { istDay } from '@/lib/topics';
import { LEVELS, PASS_PERCENT, prepareDay, testQuestions, type Question } from '@/lib/associateTraining';

export const pct = (t: { score: number | null; total: number }) => Math.round(((t.score || 0) / Math.max(1, t.total)) * 100);
// Questions as the page may see them before the test is done: no answers, no explanations.
const hidden = (qs: Question[]) => qs.map((q) => ({ id: q.id, q: q.q, options: q.options, repeat: Boolean(q.repeat) }));

// Admins and managers watch the training: they read every lesson and see everyone's progress and
// answers, in the same layout, but only associates take the tests.
export const isViewer = (role: string) => role === 'admin' || role === 'manager';
async function viewerEmails() {
  const rows = await prisma.team_members.findMany({ where: { role: { in: ['admin', 'manager'] } }, select: { email: true } });
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

// One person's training as their page shows it.
async function personView(email: string) {
  const profile = await prisma.training_profiles.findUnique({ where: { email } });
  if (!profile) return null;
  const lesson = profile.lesson_id ? await prisma.training_lessons.findUnique({ where: { id: profile.lesson_id } }) : null;
  const open = await prisma.training_tests.findFirst({ where: { email, status: 'open' }, orderBy: { day: 'desc' } });
  const results = await prisma.training_tests.findMany({ where: { email, status: { notIn: ['open', 'marking'] } }, orderBy: { day: 'desc' }, take: 20, select: { id: true, day: true, level: true, score: true, total: true, status: true, lesson_id: true } });
  const pastIds = results.map((r) => r.lesson_id).filter((x): x is number => Boolean(x));
  const past = pastIds.length ? await prisma.training_lessons.findMany({ where: { id: { in: pastIds } }, orderBy: { day: 'desc' }, select: { id: true, day: true, level: true, title: true, content_html: true, sources: true } }) : [];
  return {
    email,
    name: profile.name,
    profile: { level: profile.level, streak: profile.streak, active: profile.active },
    lesson: lesson ? { ...lesson, sources: JSON.parse(lesson.sources || '[]'), questions: undefined } : null,
    test: open ? { id: open.id, day: open.day, total: open.total, questions: hidden(testQuestions(open)) } : null,
    results: results.map((r) => ({ ...r, percent: pct(r) })),
    pastLessons: past.map((l) => ({ ...l, sources: JSON.parse(l.sources || '[]') })).filter((l) => l.id !== lesson?.id),
    dueAgain: await prisma.training_misses.count({ where: { email, cleared: false } }),
  };
}

export async function trainingView(me: { email: string; name: string; role: string }, { testId = 0, person = '' }: { testId?: number; person?: string } = {}): Promise<{ status: number; body: any }> {
  const viewer = isViewer(me.role);
  if (testId) {
    const t = await prisma.training_tests.findUnique({ where: { id: testId } });
    if (!t || (t.email !== me.email && !viewer)) return { status: 404, body: { error: 'Test not found' } };
    // 'marking' is unfinished too (it can go back to 'open', or stay there after a restart until the
    // next day): its answer key is not shown yet.
    if (t.status === 'open' || t.status === 'marking') return { status: 409, body: { error: 'Finish the test first' } };
    return { status: 200, body: { test: { ...t, questions: testQuestions(t), answers: JSON.parse(t.answers || '{}'), percent: pct(t) } } };
  }
  const base = { today: istDay(), passPercent: PASS_PERCENT, levels: LEVELS, viewer, canManage: me.role === 'admin' };

  if (!viewer) {
    if (!(await prisma.training_profiles.findUnique({ where: { email: me.email } }))) {
      await prisma.training_profiles.create({ data: { email: me.email, name: me.name } });
      // First visit: make today's lesson now, in the background.
      void prepareDay(me.email, istDay()).catch(() => {});
    }
    return { status: 200, body: { ...base, me: await personView(me.email) } };
  }

  const skip = await viewerEmails();
  const people = (await prisma.training_profiles.findMany({ orderBy: { email: 'asc' } })).filter((p) => !skip.has(p.email));
  const tests = await prisma.training_tests.findMany({ where: { status: { notIn: ['open', 'marking'] } }, orderBy: { day: 'desc' }, take: 1000, select: { email: true, day: true, score: true, total: true, status: true, id: true } });
  const misses = await prisma.training_misses.groupBy({ by: ['email'], where: { cleared: false }, _count: { _all: true } });
  const everyone = people.map((p) => {
    const mine = tests.filter((t) => t.email === p.email);
    const last5 = mine.slice(0, 5);
    return {
      email: p.email,
      name: p.name,
      level: p.level,
      active: p.active,
      streak: p.streak,
      tests: mine.length,
      average: last5.length ? Math.round(last5.reduce((a, t) => a + pct(t), 0) / last5.length) : null,
      last: mine[0] ? { id: mine[0].id, day: mine[0].day, percent: pct(mine[0]), status: mine[0].status } : null,
      dueAgain: misses.find((m) => m.email === p.email)?._count._all || 0,
    };
  });
  const todayLessons = await prisma.training_lessons.findMany({ where: { day: istDay() }, orderBy: { level: 'asc' }, select: { id: true, day: true, level: true, title: true, content_html: true, sources: true } });
  let lastRun: any = null;
  try {
    lastRun = JSON.parse((await settings.get('training_last_run')) || 'null');
  } catch {}
  return { status: 200, body: {
    ...base,
    everyone,
    todayLessons: todayLessons.map((l) => ({ ...l, sources: JSON.parse(l.sources || '[]') })),
    person: person && people.some((p) => p.email === person) ? await personView(person) : null,
    lastRun,
  } };
}

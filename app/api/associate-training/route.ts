import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { getMe } from '@/lib/auth';
import { istDay } from '@/lib/topics';
import { LEVELS, PASS_PERCENT, prepareDay, runTrainingDay, submitTest, type Question } from '@/lib/associateTraining';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

const pct = (t: { score: number | null; total: number }) => Math.round(((t.score || 0) / Math.max(1, t.total)) * 100);
// Questions as the page may see them before the test is done: no answers, no explanations.
const hidden = (qs: Question[]) => qs.map((q) => ({ id: q.id, q: q.q, options: q.options, repeat: Boolean(q.repeat) }));

// Admins and managers watch the training: they read every lesson and see everyone's progress and
// answers, in the same layout, but only associates take the tests.
const isViewer = (role: string) => role === 'admin' || role === 'manager';
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
  const results = await prisma.training_tests.findMany({ where: { email, status: { not: 'open' } }, orderBy: { day: 'desc' }, take: 20, select: { id: true, day: true, level: true, score: true, total: true, status: true, lesson_id: true } });
  const pastIds = results.map((r) => r.lesson_id).filter((x): x is number => Boolean(x));
  const past = pastIds.length ? await prisma.training_lessons.findMany({ where: { id: { in: pastIds } }, orderBy: { day: 'desc' }, select: { id: true, day: true, level: true, title: true, content_html: true, sources: true } }) : [];
  return {
    email,
    name: profile.name,
    profile: { level: profile.level, streak: profile.streak, active: profile.active },
    lesson: lesson ? { ...lesson, sources: JSON.parse(lesson.sources || '[]'), questions: undefined } : null,
    test: open ? { id: open.id, day: open.day, total: open.total, questions: hidden(JSON.parse(open.questions)) } : null,
    results: results.map((r) => ({ ...r, percent: pct(r) })),
    pastLessons: past.map((l) => ({ ...l, sources: JSON.parse(l.sources || '[]') })).filter((l) => l.id !== lesson?.id),
    dueAgain: await prisma.training_misses.count({ where: { email, cleared: false } }),
  };
}

// GET: an associate gets their own training. An admin or manager gets today's lessons for every
// level and everyone's progress; ?person=<email> shows that person's page. ?test=<id> = one finished
// test with its answers.
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const viewer = isViewer(me.role);
  const testId = Number(req.nextUrl.searchParams.get('test'));
  if (testId) {
    const t = await prisma.training_tests.findUnique({ where: { id: testId } });
    if (!t || (t.email !== me.email && !viewer)) return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    if (t.status === 'open') return NextResponse.json({ error: 'Finish the test first' }, { status: 409 });
    return NextResponse.json({ test: { ...t, questions: JSON.parse(t.questions), answers: JSON.parse(t.answers || '{}'), percent: pct(t) } });
  }
  const base = { today: istDay(), passPercent: PASS_PERCENT, levels: LEVELS, viewer, canManage: me.role === 'admin' };

  if (!viewer) {
    if (!(await prisma.training_profiles.findUnique({ where: { email: me.email } }))) {
      await prisma.training_profiles.create({ data: { email: me.email, name: me.name } });
      // First visit: make today's lesson now, in the background.
      void prepareDay(me.email, istDay()).catch(() => {});
    }
    return NextResponse.json({ ...base, me: await personView(me.email) });
  }

  const person = String(req.nextUrl.searchParams.get('person') || '').toLowerCase();
  const skip = await viewerEmails();
  const people = (await prisma.training_profiles.findMany({ orderBy: { email: 'asc' } })).filter((p) => !skip.has(p.email));
  const tests = await prisma.training_tests.findMany({ where: { status: { not: 'open' } }, orderBy: { day: 'desc' }, take: 1000, select: { email: true, day: true, score: true, total: true, status: true, id: true } });
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
  return NextResponse.json({
    ...base,
    everyone,
    todayLessons: todayLessons.map((l) => ({ ...l, sources: JSON.parse(l.sources || '[]') })),
    person: person && people.some((p) => p.email === person) ? await personView(person) : null,
    lastRun,
  });
}

// POST { action: 'submit', testId, answers } for anyone; 'run', 'active', 'level' for the admin.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  try {
    if (body.action === 'submit') {
      if (isViewer(me.role)) return NextResponse.json({ error: 'Only associates take the tests. Admins and managers can read the lessons and see the results.' }, { status: 403 });
      return NextResponse.json(await submitTest(me.email, Number(body.testId), body.answers || {}));
    }
    if (me.role !== 'admin') return NextResponse.json({ error: 'Only the admin can do this.' }, { status: 403 });
    if (body.action === 'run') {
      void runTrainingDay().catch(() => {});
      return NextResponse.json({ started: true }, { status: 202 });
    }
    const email = String(body.email || '').toLowerCase();
    if (!(await prisma.training_profiles.findUnique({ where: { email } }))) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    if (body.action === 'active') {
      await prisma.training_profiles.update({ where: { email }, data: { active: Boolean(body.active) } });
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'level') {
      const level = Math.max(1, Math.min(5, Number(body.level) || 1));
      await prisma.training_profiles.update({ where: { email }, data: { level, streak: 0 } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

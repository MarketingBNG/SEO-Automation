import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { isTrainee, markRead, playGame, runTrainingDay, setLevel, submitTest } from '@/lib/associateTraining';
import { isViewer, reportCsv, teamReport, trainingView, visibleEmails } from '@/lib/associateTrainingView';
import { trainingGate } from '@/lib/trainingGate';
import { getCatalogue } from '@/lib/uicCatalogue';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: everyone but the admin gets their own training. The admin and managers also get the team
// report; ?person=<email> shows that person's page. ?test=<id> = one finished test with its answers.
// ?gate=1 = whether today's training still locks the dashboard. ?report=csv = the team report as a
// CSV file (admin and managers). See lib/associateTrainingView.ts (shared with the assistant).
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  if (req.nextUrl.searchParams.get('gate')) {
    // The live role and block (as proxy.ts uses), not the session copy.
    const live = await import('@/lib/access').then((a) => a.liveAccessFor(me.email)).catch(() => null);
    if (live && (!live.member || live.blocked)) return NextResponse.json({ locked: false, unread: [], openTests: [], notice: null });
    return NextResponse.json(await trainingGate(me.email, live?.role || me.role));
  }
  if (req.nextUrl.searchParams.get('report') === 'csv') {
    if (!isViewer(me.role)) return NextResponse.json({ error: 'Only the admin or a manager can download the report.' }, { status: 403 });
    const only = await visibleEmails(me);
    return new NextResponse(reportCsv(await teamReport(only)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="training-report-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const r = await trainingView(me, { testId: Number(req.nextUrl.searchParams.get('test')), person: String(req.nextUrl.searchParams.get('person') || '').toLowerCase() });
  return NextResponse.json(r.body, { status: r.status });
}

// POST { action: 'submit', testId, answers }, { action: 'read', lessonId }, { action: 'game', lessonId,
// answers } for everyone in the training; 'run', 'active', 'level', 'catalogue' for the admin.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  try {
    if (['submit', 'read', 'game'].includes(body.action) && !isTrainee(me.role)) {
      return NextResponse.json({ error: 'The admin watches the training; everyone else takes it.' }, { status: 403 });
    }
    if (body.action === 'submit') return NextResponse.json(await submitTest(me.email, Number(body.testId), body.answers || {}));
    if (body.action === 'read') return NextResponse.json(await markRead(me.email, Number(body.lessonId)));
    if (body.action === 'game') return NextResponse.json(await playGame(me.email, Number(body.lessonId), body.answers || {}));
    if (me.role !== 'admin') return NextResponse.json({ error: 'Only the admin can do this.' }, { status: 403 });
    if (body.action === 'catalogue') return NextResponse.json(await getCatalogue({ refresh: true }));
    if (body.action === 'run') {
      void runTrainingDay().catch((e: any) => activity.log('training.failed', { details: String(e?.message || e).slice(0, 300), actor: me.name }).catch(() => {}));
      return NextResponse.json({ started: true }, { status: 202 });
    }
    const email = String(body.email || '').toLowerCase();
    if (!(await prisma.training_profiles.findUnique({ where: { email } }))) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    if (body.action === 'active') {
      await prisma.training_profiles.update({ where: { email }, data: { active: Boolean(body.active) } });
      (await import('@/lib/trainingGate')).forgetGate(email);
      await activity.log('training.profile_changed', { details: `${email}: ${body.active ? 'added back to' : 'taken out of'} the training`, actor: me.name });
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'level') {
      const level = Math.max(1, Math.min(5, Number(body.level) || 1));
      await setLevel(email, level, `set by ${me.name}`, me.name);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

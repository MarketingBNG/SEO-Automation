import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { runTrainingDay, submitTest } from '@/lib/associateTraining';
import { isViewer, trainingView } from '@/lib/associateTrainingView';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: an associate gets their own training. An admin or manager gets today's lessons for every
// level and everyone's progress; ?person=<email> shows that person's page. ?test=<id> = one finished
// test with its answers. See lib/associateTrainingView.ts (shared with the assistant).
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const r = await trainingView(me, { testId: Number(req.nextUrl.searchParams.get('test')), person: String(req.nextUrl.searchParams.get('person') || '').toLowerCase() });
  return NextResponse.json(r.body, { status: r.status });
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
      void runTrainingDay().catch((e: any) => activity.log('training.failed', { details: String(e?.message || e).slice(0, 300), actor: me.name }).catch(() => {}));
      return NextResponse.json({ started: true }, { status: 202 });
    }
    const email = String(body.email || '').toLowerCase();
    if (!(await prisma.training_profiles.findUnique({ where: { email } }))) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    if (body.action === 'active') {
      await prisma.training_profiles.update({ where: { email }, data: { active: Boolean(body.active) } });
      await activity.log('training.profile_changed', { details: `${email}: ${body.active ? 'added back to' : 'taken out of'} the training`, actor: me.name });
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'level') {
      const level = Math.max(1, Math.min(5, Number(body.level) || 1));
      await prisma.training_profiles.update({ where: { email }, data: { level, streak: 0 } });
      await activity.log('training.profile_changed', { details: `${email}: level set to ${level} (streak reset)`, actor: me.name });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

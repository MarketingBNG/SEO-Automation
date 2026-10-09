import { NextRequest, NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import { getMe, getActor } from '@/lib/auth';
import { runSitePlan, plannerOpen, PLANNER_UNTIL } from '@/lib/sitePlanner';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

async function guard() {
  const me = await getMe();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only the admin can use the Website Planner.' }, { status: 403 });
  if (!plannerOpen()) return NextResponse.json({ error: 'The Website Planner was a temporary section and is now closed.' }, { status: 410 });
  return null;
}

// GET: the plan (if made), the job state and when the section closes.
export async function GET() {
  const no = await guard();
  if (no) return no;
  const parse = (s: string | null) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  return NextResponse.json({ plan: parse(await settings.get('site_plan')), status: parse(await settings.get('site_plan_status')), closesAt: new Date(PLANNER_UNTIL).toISOString() });
}

// POST { brief? }: make (or remake) the plan in the background.
export async function POST(req: NextRequest) {
  const no = await guard();
  if (no) return no;
  const { brief }: any = (await req.json().catch(() => ({}))) || {};
  void runSitePlan(await getActor(), String(brief || '').slice(0, 3000)).catch(() => {});
  return NextResponse.json({ started: true }, { status: 202 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

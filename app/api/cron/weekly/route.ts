// Weekly cron (Mondays): plan vs actual check for the approved strategy.
import { NextResponse } from 'next/server';
import { runWeekly } from '@/lib/strategy/autopilot';
import { runAutomatic } from '@/lib/aiQueue';
import * as settings from '@/lib/settings';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  // Only the scheduled task (CRON_SECRET) runs it; a signed-in browser cannot start paid work here.
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Cron only' }, { status: 403 });
  // Once a day at most (the same guard as the built-in scheduler): each run makes paid SE Ranking
  // calls, saves a plan check and posts a notice.
  const today = new Date().toISOString().slice(0, 10);
  if ((await settings.get('last_weekly_run')) === today) return NextResponse.json({ skipped: 'Already ran today.' });
  // Automatic work: in Testing mode it does not start (lib/aiQueue.ts).
  const r: any = await runAutomatic(() => runWeekly());
  // A skipped run (no approved strategy yet) did not happen: a strategy approved later today still gets its check.
  if (!r?.error && !r?.skipped) await settings.set('last_weekly_run', today);
  return NextResponse.json(r);
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

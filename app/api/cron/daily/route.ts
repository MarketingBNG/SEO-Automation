// Daily cron: drafts upcoming blogs, opens 48-hour review windows, auto-approves and publishes due
// blogs only after the automatic fact check passes, and runs the priority-keyword rank check.
// Run it every 15 minutes (Coolify Scheduled Task). Every step is idempotent, an overlapping call is skipped,
// and the rank check runs once per day.
import { NextResponse } from 'next/server';
import { runDaily } from '@/lib/strategy/autopilot';
import { runAutomatic } from '@/lib/aiQueue';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
// Only applies on Vercel (300 is its plan limit). The self-hosted Coolify server has no time limit.
export const maxDuration = 300;

export async function GET(req: Request) {
  // Only the scheduled task (CRON_SECRET) runs it; a signed-in browser cannot start paid work here.
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Cron only' }, { status: 403 });
  // Automatic work: in Testing mode it does not start (lib/aiQueue.ts).
  return NextResponse.json(await runAutomatic(() => runDaily()));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

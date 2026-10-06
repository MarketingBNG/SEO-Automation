// Daily cron: drafts upcoming blogs, opens 24-hour review windows, auto-approves and publishes due
// blogs behind the Facts Register gate, and runs the priority-keyword rank check.
// Run it every 15 minutes (Coolify Scheduled Task). Every step is idempotent, an overlapping call is skipped,
// and the rank check runs once per day.
import { NextResponse } from 'next/server';
import { runDaily } from '@/lib/strategy/autopilot';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
// Only applies on serverless hosts. On the self-hosted Coolify server there is no time limit.
export const maxDuration = 800;

export async function GET() {
  return NextResponse.json(await runDaily());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

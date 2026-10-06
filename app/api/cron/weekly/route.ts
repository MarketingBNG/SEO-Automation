// Weekly cron (Mondays): plan vs actual check for the approved strategy.
import { NextResponse } from 'next/server';
import { runWeekly } from '@/lib/strategy/autopilot';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(await runWeekly());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

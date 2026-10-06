// Daily cron: drafts upcoming blogs, opens 24-hour review windows, auto-approves and publishes due
// blogs behind the Facts Register gate, and runs the priority-keyword rank check.
// Idempotent, so it can also be called hourly (Vercel Pro or an external scheduler).
import { NextResponse } from 'next/server';
import { runDaily } from '@/lib/strategy/autopilot';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
// Hobby plan limit is 300 seconds. Maximum-effort research runs need Vercel Pro: raise this to 800 there.
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(await runDaily());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

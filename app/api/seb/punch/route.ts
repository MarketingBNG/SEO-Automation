import { NextRequest, NextResponse } from 'next/server';
import { sebSessionEmail, SEB_COOKIE } from '@/lib/seb';
import { checkIn, attendanceStatus } from '@/lib/attendance';
import { liveDeps, isConnected } from '@/lib/zohoPeople';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The daily Check In button (SEB session). Records today's attendance in Zoho People idempotently, and
// reuses today's already-confirmed punch after a restart. GET returns today's status without punching.
export async function GET(req: NextRequest) {
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 });
  return NextResponse.json({ attendance: await attendanceStatus(email) });
}

export async function POST(req: NextRequest) {
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 });
  let attendance: any;
  try {
    if (await isConnected(email)) attendance = await checkIn(email, liveDeps);
    else attendance = { status: 'not-connected', reason: 'Connect Zoho People once from your phone or regular browser.' };
  } catch (e: any) {
    attendance = { status: 'failed', retryable: true, reason: String(e?.message || e) };
  }
  return NextResponse.json({ attendance });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

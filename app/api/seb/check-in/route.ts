import { NextRequest, NextResponse } from 'next/server';
import { redeemHandoff, createSebSession, SEB_COOKIE } from '@/lib/seb';
import { checkIn } from '@/lib/attendance';
import { liveDeps, isConnected } from '@/lib/zohoPeople';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// SEB Check In: redeem the single-use handoff code (identity), open an SEB session (httpOnly cookie),
// and record attendance in Zoho People idempotently. Training can proceed even if attendance is pending
// or Zoho is not connected; the status is reported accurately.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = await redeemHandoff(String(body.code || '').trim());
  if (!email) return NextResponse.json({ error: 'Invalid or expired code. Get a fresh code in your regular browser.' }, { status: 401 });

  const token = await createSebSession(email);
  let attendance: any;
  try {
    if (await isConnected(email)) attendance = await checkIn(email, liveDeps);
    else attendance = { status: 'not-connected', reason: 'Connect Zoho People once from your phone or regular browser.' };
  } catch (e: any) {
    attendance = { status: 'failed', retryable: true, reason: String(e?.message || e) };
  }

  const secure = (process.env.NEXTAUTH_URL || '').startsWith('https://') ? '; Secure' : '';
  const res = NextResponse.json({ ok: true, email, attendance });
  res.headers.set('Set-Cookie', `${SEB_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=36000${secure}`);
  return res;
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

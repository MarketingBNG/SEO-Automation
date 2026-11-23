import { NextRequest, NextResponse } from 'next/server';
import { redeemHandoff, createSebSession, SEB_COOKIE, sebLog, newReqId } from '@/lib/seb';
import { createEnrollment } from '@/lib/sebEnroll';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// SEB first-time Check In: redeem the single-use handoff code (identity) and open an SEB session
// (httpOnly cookie). If the Windows launcher asks to enrol (windowsUser + enroll:true), create a
// long-lived revocable credential bound to this employee and this Windows user, returned ONCE for the
// launcher to store securely in Windows. Attendance is recorded by the daily Check In button
// (/api/seb/punch), not here.
export async function POST(req: NextRequest) {
  const rid = newReqId();
  const t0 = Date.now();
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = await redeemHandoff(String(body.code || '').trim());
  // "redeemed=false" distinguishes an invalid/expired/already-used code from a server stall. No code value
  // is logged. A consumed single-use code whose response was lost will log redeemed=false on a retry; the
  // client then relies on /api/seb/today to detect the session that may already exist.
  sebLog('check-in', rid, 'redeem', { ms: Date.now() - t0, redeemed: Boolean(email) });
  if (!email) return NextResponse.json({ error: 'Invalid or expired code. Get a fresh code in your regular browser.' }, { status: 401 });

  const tSession = Date.now();
  const token = await createSebSession(email);
  sebLog('check-in', rid, 'session', { ms: Date.now() - tSession });

  let enrollment: { id: string; secret: string } | undefined;
  if (body.enroll && body.windowsUser) {
    const tEnroll = Date.now();
    try {
      enrollment = await createEnrollment(email, String(body.windowsUser), body.label ? String(body.label) : undefined);
      sebLog('check-in', rid, 'enroll', { ms: Date.now() - tEnroll, created: true });
    } catch (e: any) {
      enrollment = undefined;
      sebLog('check-in', rid, 'enroll', { ms: Date.now() - tEnroll, created: false, msg: String(e?.message || e) });
    }
  }

  const secure = (process.env.NEXTAUTH_URL || '').startsWith('https://') ? '; Secure' : '';
  const res = NextResponse.json({ ok: true, email, enrollment });
  res.headers.set('Set-Cookie', `${SEB_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=36000${secure}`);
  sebLog('check-in', rid, 'done', { ms: Date.now() - t0, enrolled: Boolean(enrollment) });
  return res;
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { redeemHandoff, createSebSession, SEB_COOKIE } from '@/lib/seb';
import { createEnrollment } from '@/lib/sebEnroll';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// SEB first-time Check In: redeem the single-use handoff code (identity) and open an SEB session
// (httpOnly cookie). If the Windows launcher asks to enrol (windowsUser + enroll:true), create a
// long-lived revocable credential bound to this employee and this Windows user, returned ONCE for the
// launcher to store securely in Windows. Attendance is recorded by the daily Check In button
// (/api/seb/punch), not here.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = await redeemHandoff(String(body.code || '').trim());
  if (!email) return NextResponse.json({ error: 'Invalid or expired code. Get a fresh code in your regular browser.' }, { status: 401 });

  const token = await createSebSession(email);
  let enrollment: { id: string; secret: string } | undefined;
  if (body.enroll && body.windowsUser) {
    try {
      enrollment = await createEnrollment(email, String(body.windowsUser), body.label ? String(body.label) : undefined);
    } catch {
      enrollment = undefined;
    }
  }

  const secure = (process.env.NEXTAUTH_URL || '').startsWith('https://') ? '; Secure' : '';
  const res = NextResponse.json({ ok: true, email, enrollment });
  res.headers.set('Set-Cookie', `${SEB_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=36000${secure}`);
  return res;
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

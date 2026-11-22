import { NextRequest, NextResponse } from 'next/server';
import { mintHandoff } from '@/lib/seb';
import { exchangeEnrollment } from '@/lib/sebEnroll';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Silent re-auth on each SEB launch/reboot. The Windows launcher (which holds the enrollment credential
// in Windows secure storage and knows the current Windows user) exchanges it here. On success we mint a
// FRESH single-use handoff code; the launcher opens SEB at /seb#code=<code> (a URL fragment never leaves
// the browser), and the page redeems it for the SEB session. The durable credential never goes in a URL.
// A 401 with reason "enroll_required" means fall back to Check In (revoked, wrong credential, or a
// different Windows user).
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = await exchangeEnrollment(String(body.id || ''), String(body.secret || ''), String(body.windowsUser || ''));
  if (!email) return NextResponse.json({ error: 'Enrollment not valid for this Windows user.', reason: 'enroll_required' }, { status: 401 });
  const { code } = await mintHandoff(email);
  return NextResponse.json({ ok: true, code });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

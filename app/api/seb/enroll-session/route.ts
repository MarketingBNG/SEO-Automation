import { NextRequest, NextResponse } from 'next/server';
import { mintHandoff, shouldLaunchSeb } from '@/lib/seb';
import { exchangeEnrollment } from '@/lib/sebEnroll';
import { gateForEmail } from '@/lib/worklog';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Silent re-auth on each SEB launch/reboot. The Windows launcher (which holds the enrollment credential
// in Windows secure storage and knows the current Windows user) exchanges it here. On a valid credential
// we run the SAME gate the device uses, then mint a FRESH single-use handoff code ONLY when training is
// pending (the gate returns "pending" at/after 09:00 IST on a training day that is not yet done). The
// launcher opens SEB at /seb#code=<code> (a URL fragment never leaves the browser), and the page redeems
// it for the SEB session. The durable credential never goes in a URL.
//
// Responses:
//   200 { ok, status, launch, code? } - code present only when launch is true (status "pending").
//     status "before-window" (before 09:00), "no-training" (Sunday / none), "done" (already finished) and
//     "not-ready" all return launch:false and no code, so the launcher leaves the normal desktop alone.
//   401 { reason: "enroll_required" } - revoked, wrong credential, or a different Windows user: re-enroll.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = await exchangeEnrollment(String(body.id || ''), String(body.secret || ''), String(body.windowsUser || ''));
  if (!email) return NextResponse.json({ error: 'Enrollment not valid for this Windows user.', reason: 'enroll_required' }, { status: 401 });
  const gate = await gateForEmail(email);
  const launch = shouldLaunchSeb(gate.status);
  const code = launch ? (await mintHandoff(email)).code : undefined;
  return NextResponse.json({ ok: true, status: gate.status, launch, code });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

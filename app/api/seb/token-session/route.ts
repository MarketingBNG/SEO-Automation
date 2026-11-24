import { NextRequest, NextResponse } from 'next/server';
import { getWorkToken } from '@/lib/workToken';
import { emailForToken, gateForEmail } from '@/lib/worklog';
import { mintHandoff, shouldLaunchSeb, sebLog, newReqId } from '@/lib/seb';
import { isConnected as zohoPeopleConnected } from '@/lib/zohoPeople';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The device's one-time work token (the SAME token installed for the activity watcher) opens SEB without
// ever asking for a code. The launcher sends the token (x-work-token header); we resolve the person, run
// the SAME gate the device uses, and mint a FRESH single-use handoff code ONLY when training is pending.
// The launcher opens SEB at /seb#code=... (a URL fragment never leaves the browser), and the page redeems
// it for the SEB session. No code is ever typed; the token is the one-time verification. A missing or
// unknown token -> 401 (the device is not set up).
//
// Responses mirror enroll-session: 200 { ok, status, launch, code? } with code only when launch (pending);
// before-window / no-training / done / not-ready return launch:false and no code, so the launcher leaves
// the normal desktop alone (a finished day never reopens SEB).
export async function POST(req: NextRequest) {
  const rid = newReqId();
  const email = await emailForToken(getWorkToken(req));
  if (!email) return NextResponse.json({ error: 'This device is not set up for training. Ask your admin.', reason: 'not_set_up' }, { status: 401 });
  const gate = await gateForEmail(email);
  const launch = shouldLaunchSeb(gate.status);
  const code = launch ? (await mintHandoff(email)).code : undefined;
  // Whether this person has connected their Zoho People (so the device verify tool can report if the
  // attendance Check In will work). No secret is returned.
  const zohoConnected = await zohoPeopleConnected(email).catch(() => false);
  sebLog('token-session', rid, 'done', { status: gate.status, launch, zoho: zohoConnected });
  return NextResponse.json({ ok: true, status: gate.status, launch, code, zohoConnected });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

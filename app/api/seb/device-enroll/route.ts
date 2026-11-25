import { NextRequest, NextResponse } from 'next/server';
import { emailForToken } from '@/lib/worklog';
import { createEnrollment } from '@/lib/sebEnroll';
import { sebLog, newReqId } from '@/lib/seb';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// One-step device enrollment for the Windows setup script: the employee's work token (from Device setup)
// identifies the person, so no one-time code has to be typed. Creates the revocable SEB enrollment bound
// to this Windows user (SID) and returns it ONCE for the device to store under DPAPI.
//   POST { deviceToken, windowsUser, label? } -> 200 { ok, enrollment: { id, secret } }
//   400 missing fields; 401 unknown token. The token and secret are never logged.
export async function POST(req: NextRequest) {
  const rid = newReqId();
  const body: any = (await req.json().catch(() => ({}))) || {};
  const deviceToken = String(body.deviceToken || '').trim();
  const windowsUser = String(body.windowsUser || '').trim();
  const label = body.label ? String(body.label).slice(0, 100) : undefined;
  if (!deviceToken || !windowsUser) return NextResponse.json({ error: 'deviceToken and windowsUser are required.' }, { status: 400 });
  const email = await emailForToken(deviceToken);
  if (!email) { sebLog('device-enroll', rid, 'unknown-token'); return NextResponse.json({ error: 'Unknown work token. Get the current token from Device setup.' }, { status: 401 }); }
  const enrollment = await createEnrollment(email, windowsUser, label);
  sebLog('device-enroll', rid, 'enrolled', { label: label || '' });
  return NextResponse.json({ ok: true, enrollment });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

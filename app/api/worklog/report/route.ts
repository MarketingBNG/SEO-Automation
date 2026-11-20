import { NextRequest, NextResponse } from 'next/server';
import { getWorkToken } from '@/lib/workToken';
import { emailForToken, reportActive } from '@/lib/worklog';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The Windows activity watcher posts here with its per-person work token (x-work-token header) and the
// active milliseconds since its last report. No sign-in: the token identifies the person. The proxy
// has already checked the token is present and that this is the only endpoint it may reach.
export async function POST(req: NextRequest) {
  const token = getWorkToken(req);
  const email = await emailForToken(token);
  if (!email) return NextResponse.json({ error: 'Unknown work token' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await reportActive(email, Number(body.activeMs || body.ms || 0));
  return NextResponse.json(r);
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

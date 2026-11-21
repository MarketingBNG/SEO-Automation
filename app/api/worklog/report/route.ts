import { NextRequest, NextResponse } from 'next/server';
import { getWorkToken } from '@/lib/workToken';
import { emailForToken, reportActivity } from '@/lib/worklog';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The Windows activity watcher posts here with its per-person work token (x-work-token header) and the
// apps it saw active since the last report: { apps: [{ app, ms }] }. (A single { activeMs } still
// works, logged under "Work".) No sign-in: the token identifies the person. The proxy has already
// checked the token is present and that this is the only endpoint it may reach.
export async function POST(req: NextRequest) {
  const token = getWorkToken(req);
  const email = await emailForToken(token);
  if (!email) return NextResponse.json({ error: 'Unknown work token' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const apps = Array.isArray(body.apps) ? body.apps : body.activeMs || body.ms ? [{ app: String(body.app || 'Work'), ms: Number(body.activeMs || body.ms) }] : [];
  const r = await reportActivity(email, apps);
  return NextResponse.json(r);
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

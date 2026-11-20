import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { CONSENT_POINTS, CONSENT_TITLE, CONSENT_VERSION, consentNeededForRole, hasConsent, recordConsent } from '@/lib/consent';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: whether this person still needs to accept the monitoring terms, and the terms to show.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const needed = consentNeededForRole(me.role) && !(await hasConsent(me.email));
  return NextResponse.json({ needed, version: CONSENT_VERSION, title: CONSENT_TITLE, points: CONSENT_POINTS });
}

// POST { accept: true }: record that this person accepted the current version.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  if (!body.accept) return NextResponse.json({ error: 'Tick the box to agree first.' }, { status: 400 });
  return NextResponse.json(await recordConsent(me.email));
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { listEnrollments, revokeEnrollment, revokeForEmail } from '@/lib/sebEnroll';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Admin: see and revoke SEB device enrollments (makes the launcher ask for a code again). Session-gated
// (admin only); not bypassed by the SEB-cookie rule in the proxy.
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const email = String(req.nextUrl.searchParams.get('email') || '').trim() || undefined;
  return NextResponse.json({ enrollments: await listEnrollments(email) });
}

export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  if (body.action === 'revoke' && body.id) return NextResponse.json({ revoked: await revokeEnrollment(String(body.id)) });
  if (body.action === 'revoke-email' && body.email) return NextResponse.json({ revoked: await revokeForEmail(String(body.email)) });
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

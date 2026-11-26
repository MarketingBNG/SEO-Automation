import { NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { diagnostics, isConnected } from '@/lib/zohoPeople';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Admin-only, read-only, secret-free diagnostics for the Zoho People OAuth connect. Shows exactly what
// the server would send to Zoho (redirect_uri, accounts host, scope, region match, authorize URL) so a
// redirect/region mismatch is pinpointed without reading env or the Zoho API console. No secret, token or
// authorization code is ever returned.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  if (me.role !== 'admin') return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  // Check-in troubleshooting: each trainee, whether they connected Zoho People, and their recent
  // check-in attempts with Zoho's own error text (the "note"), so a failing Check In shows WHY.
  const db: any = prisma;
  const people = await db.training_profiles.findMany({ where: { active: true }, select: { email: true, name: true } }).catch(() => []);
  const trainees = await Promise.all(people.map(async (p: any) => ({ email: p.email, name: p.name, zohoPeopleConnected: await isConnected(p.email).catch(() => false) })));
  const recentCheckIns = await db.attendance_punches.findMany({ orderBy: [{ day: 'desc' }, { email: 'asc' }], take: 60, select: { email: true, day: true, status: true, attempts: true, note: true, updated_at: true } }).catch(() => []);
  return NextResponse.json({ ...diagnostics(), trainees, recentCheckIns });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

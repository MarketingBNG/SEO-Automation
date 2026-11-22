import { NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { isConnected, REQUIRED_ACCESS } from '@/lib/zohoPeople';

export const runtime = 'nodejs';

// Whether the signed-in person has connected Zoho People, plus the access the admin must confirm on the
// Zoho side for the live pilot (surfaced so a missing plan/scope is visible early).
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  return NextResponse.json({ connected: await isConnected(me.email), requiredAccess: me.role === 'admin' ? REQUIRED_ACCESS : undefined });
}

import { NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { isConnected } from '@/lib/zohoProjects';

export const runtime = 'nodejs';

// Whether the signed-in person has connected their Zoho. Used by the connect banner.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  return NextResponse.json({ connected: await isConnected(me.email), role: me.role });
}

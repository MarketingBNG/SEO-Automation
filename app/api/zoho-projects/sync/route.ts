import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { syncPersonDay, syncAllDay } from '@/lib/zohoProjects';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Admin only. Log hours to Zoho for a day.
//   { email, day? }  -> one person
//   { all: true, day? } -> everyone tracked
// day is YYYY-MM-DD; omit for today (the IST day). For the once-a-day job you pass yesterday.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  if (me.role !== 'admin') return NextResponse.json({ error: 'Only the admin can run the Zoho sync.' }, { status: 403 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const day = String(body.day || '').trim() || undefined;
  try {
    if (body.all) return NextResponse.json({ results: await syncAllDay(day) });
    const email = String(body.email || '').toLowerCase();
    if (!email) return NextResponse.json({ error: 'Which person? Pass email, or all: true.' }, { status: 400 });
    return NextResponse.json({ result: await syncPersonDay(email, day) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

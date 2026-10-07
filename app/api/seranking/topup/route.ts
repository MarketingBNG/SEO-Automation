import { NextResponse } from 'next/server';
import { topUpTrackedKeywords } from '@/lib/keywordTracking';
import { timed, startedAt } from '@/lib/jobTimer';
import * as settings from '@/lib/settings';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// POST: adds missing keywords to SE Ranking tracking in the background (it also runs every Monday).
// Returns at once, so a closed page or a dropped connection cannot stop it; the header shows a live
// timer and GET returns the last result.
export async function POST() {
  if (startedAt('keywords-topup')) return NextResponse.json({ started: false, running: true });
  void timed('keywords-topup', 'keywords', 'Adding keywords to SE Ranking tracking', () => topUpTrackedKeywords())
    .then((r) => settings.set('last_keyword_topup_result', JSON.stringify({ ...r, at: new Date().toISOString() })))
    .catch((e) => settings.set('last_keyword_topup_result', JSON.stringify({ error: e.message, at: new Date().toISOString() })));
  return NextResponse.json({ started: true });
}

export async function GET() {
  const raw = await settings.get('last_keyword_topup_result');
  return NextResponse.json({ running: Boolean(startedAt('keywords-topup')), last: raw ? JSON.parse(raw) : null });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

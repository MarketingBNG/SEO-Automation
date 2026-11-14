import { NextRequest, NextResponse } from 'next/server';
import { researchTopics } from '@/lib/topics';
import { topicsView } from '@/lib/topicsView';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: today's topics (news from the last 24 hours and evergreen), plus older topics someone
// already started on. Untouched topics from earlier days are not shown.
export async function GET() {
  return NextResponse.json(await topicsView());
}

// POST { action: 'research' }: run today's research now (again).
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  if (body.action !== 'research') return NextResponse.json({ error: 'action must be research' }, { status: 400 });
  // Runs in the background; the page polls.
  void researchTopics(new Date(), { force: true }).catch(() => {});
  return NextResponse.json({ started: true }, { status: 202 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

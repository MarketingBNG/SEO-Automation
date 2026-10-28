import { NextRequest, NextResponse } from 'next/server';
import { blogRuns } from '@/lib/blogRuns';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Stops one blog generation: { keywordId }. Other people's blogs (Topics, resumed runs) keep going,
// so a body without a keyword id is refused. Who pressed Stop is logged here: the run's own
// 'stopped' row names whoever started it.
export async function POST(req: NextRequest) {
  const { keywordId }: any = (await req.json().catch(() => ({}))) || {};
  const id = Number(keywordId);
  if (!keywordId || !Number.isSafeInteger(id)) return NextResponse.json({ error: 'Say which blog to stop (keywordId).' }, { status: 400 });
  let stopped = 0;
  const c = blogRuns.get(id);
  if (c) {
    c.abort();
    stopped++;
    await activity.log('draft.generation_stop_requested', { entityType: 'keyword', entityId: id, details: 'Stop pressed', actor: await getActor() }).catch(() => {});
  }
  return NextResponse.json({ stopped });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

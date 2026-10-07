import { NextRequest, NextResponse } from 'next/server';
import { blogRuns } from '@/lib/blogRuns';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Stops a blog generation: { keywordId } stops that one, an empty body stops every running one.
export async function POST(req: NextRequest) {
  const { keywordId }: any = (await req.json().catch(() => ({}))) || {};
  const ids = keywordId ? [Number(keywordId)] : [...blogRuns.keys()];
  let stopped = 0;
  for (const id of ids) {
    const c = blogRuns.get(id);
    if (c) {
      c.abort();
      stopped++;
    }
  }
  return NextResponse.json({ stopped });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

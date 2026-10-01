import { NextRequest, NextResponse } from 'next/server';
import { getSiteRankings, listSites } from '@/lib/seranking';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    let siteId: any = req.nextUrl.searchParams.get('siteId');
    if (!siteId) {
      const sites: any[] = await listSites();
      if (!sites.length) return NextResponse.json({ error: 'No SE Ranking sites found' }, { status: 404 });
      siteId = sites[0].id;
    }
    const rankings = await getSiteRankings(siteId);
    return NextResponse.json(rankings, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

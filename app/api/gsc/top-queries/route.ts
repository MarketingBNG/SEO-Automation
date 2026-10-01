import { NextResponse } from 'next/server';
import { getTopQueries } from '@/lib/searchConsole';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const rows: any[] = await getTopQueries({ days: 28, rowLimit: 25 });
    return NextResponse.json(
      rows.map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      })),
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

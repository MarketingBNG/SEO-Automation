import { NextRequest, NextResponse } from 'next/server';
import { runPageSpeedCheck } from '@/lib/pagespeed';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const url = sp.get('url') || 'https://usaindiacfo.com/';
    const strategy = sp.get('strategy') === 'desktop' ? 'desktop' : 'mobile';
    const result = await runPageSpeedCheck(url, strategy);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

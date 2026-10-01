import { NextRequest, NextResponse } from 'next/server';
import { getSummary } from '@/lib/ga4';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const days = parseInt(req.nextUrl.searchParams.get('days') as any, 10) || 28;
    const summary = await getSummary(days);
    return NextResponse.json(summary, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

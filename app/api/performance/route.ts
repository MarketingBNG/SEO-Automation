import { NextRequest, NextResponse } from 'next/server';
import { cachedPerformance } from '@/lib/performanceReport';
import { methodNotAllowed } from '../_lib/http';

// GET /api/performance?days=28 (7 to 90): SEO, AEO and GEO performance against the previous period.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(90, Math.max(7, parseInt(sp.get('days') as any, 10) || 28));
  try {
    return NextResponse.json(await cachedPerformance(days, { fresh: sp.get('fresh') === '1' }), { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

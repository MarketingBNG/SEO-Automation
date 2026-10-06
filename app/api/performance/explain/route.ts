import { NextRequest, NextResponse } from 'next/server';
import { explainPerformance } from '@/lib/performanceExplain';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET /api/performance/explain?view=overall|seo|aeo|geo&days=28[&fresh=1]: the "why it changed"
// paragraph for the end of each report. Written once per period and saved.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(90, Math.max(7, parseInt(sp.get('days') as any, 10) || 28));
  try {
    return NextResponse.json(await explainPerformance(String(sp.get('view') || 'overall'), days, { fresh: sp.get('fresh') === '1' }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

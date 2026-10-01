import { NextResponse } from 'next/server';
import { gatherMonthlyMetrics } from '@/lib/monthlyMetrics';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Live month-over-month numbers (no AI involved), shown at the top of the SEO Strategy tab.
export async function GET() {
  try {
    return NextResponse.json(await gatherMonthlyMetrics(28), { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The approved month's blog calendar with live status (planned, in review, held, published).
export async function GET() {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return NextResponse.json({ strategyId: null, rows: [] });
  const rows = await prisma.blog_schedule.findMany({ where: { strategy_id: s.id }, orderBy: { publish_at: 'asc' } });
  return NextResponse.json({ strategyId: s.id, rows: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags), hold_reasons: JSON.parse(r.hold_reasons || '[]'), post_publish_log: JSON.parse(r.post_publish_log || 'null'), fact_check: JSON.parse(r.fact_check || 'null') })) });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

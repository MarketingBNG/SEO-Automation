import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { parseStrategyRow } from '@/lib/strategyPlanner';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const { status, summary, keyword_priorities, content_recommendations, technical_recommendations, competitor_notes }: any =
    (await req.json().catch(() => ({}))) || {};

  const existing: any = await prisma.seo_strategies.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (status === 'approved') {
    // Only one strategy is active at a time - demote any previously approved one.
    await prisma.seo_strategies.updateMany({ where: { status: 'approved' }, data: { status: 'superseded' } });
  }

  // The summary lives in both the plain column and the structured report; keep them in step.
  let reportJson: string | null = null;
  if (typeof summary === 'string' && existing.report_json) {
    const report = JSON.parse(existing.report_json);
    report.summary = summary;
    reportJson = JSON.stringify(report);
  }

  // Was: col = COALESCE(?, col) for each value below, decided_at set when status IS NOT NULL.
  const values: Record<string, any> = {
    summary: summary ?? null,
    keyword_priorities: keyword_priorities ? JSON.stringify(keyword_priorities) : null,
    content_recommendations: content_recommendations ? JSON.stringify(content_recommendations) : null,
    technical_recommendations: technical_recommendations ? JSON.stringify(technical_recommendations) : null,
    competitor_notes: competitor_notes ?? null,
    report_json: reportJson,
    status: status ?? null,
  };
  const data: any = {};
  for (const [k, v] of Object.entries(values)) if (v !== null) data[k] = v;
  if ((status ?? null) !== null) data.decided_at = sqlNow();
  if (Object.keys(data).length) await prisma.seo_strategies.update({ where: { id: nid }, data });

  if (status) {
    await activity.log(`strategy.${status}`, {
      entityType: 'seo_strategy',
      entityId: Number(id),
      details: existing.period,
      actor: await getActor(),
    });
  }

  return NextResponse.json(parseStrategyRow(await prisma.seo_strategies.findUnique({ where: { id: nid } })), { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { parseStrategyRow, pickBrief } from '@/lib/strategyPlanner';
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

  // Approving a strategy queues its new-article picks into the blog pipeline automatically, each with
  // its brief. Drafts are still only written when someone clicks "Generate next blog draft", and every
  // draft still needs review in Drafts & Review before it is published.
  let queued = 0;
  if (status === 'approved' && existing.report_json) {
    const fresh: any = await prisma.seo_strategies.findUnique({ where: { id: nid } });
    const report = JSON.parse(fresh.report_json);
    for (const pick of report.picks || []) {
      if (pick.action !== 'new' || !pick.keyword || pick.status?.keywordId) continue;
      const found: any[] = await prisma.$queryRaw`SELECT id FROM keywords WHERE lower(keyword) = lower(${pick.keyword}) AND status IN ('pending', 'generating', 'drafted') LIMIT 1`;
      const keywordId = found[0]
        ? Number(found[0].id)
        : (
            await prisma.keywords.create({
              data: { batch_name: `Strategy ${existing.period}`, keyword: pick.keyword, notes: await pickBrief(pick, existing.period), status: 'pending' },
            })
          ).id;
      pick.status = { ...pick.status, keywordId };
      queued++;
    }
    if (queued) await prisma.seo_strategies.update({ where: { id: nid }, data: { report_json: JSON.stringify(report) } });
  }

  if (status) {
    await activity.log(`strategy.${status}`, {
      entityType: 'seo_strategy',
      entityId: Number(id),
      details: queued ? `${existing.period}; ${queued} new article(s) queued in Keywords` : existing.period,
      actor: await getActor(),
    });
  }

  return NextResponse.json(parseStrategyRow(await prisma.seo_strategies.findUnique({ where: { id: nid } })), { status: 200 });
}
// Deletes a strategy (any status, including approved) so a fresh one can be generated for the month.
// Keywords it queued that have not been written yet are removed too; drafts already written are kept.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);
  const existing: any = await prisma.seo_strategies.findUnique({ where: { id: nid } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.status === 'generating') return NextResponse.json({ error: 'This strategy is still being generated.' }, { status: 409 });

  const report = existing.report_json ? JSON.parse(existing.report_json) : {};
  const keywordIds = [...(report.picks || []), ...(report.quickEdits || []), ...(report.nextInLine || [])]
    .map((p: any) => p?.status?.keywordId)
    .filter((k: any) => Number.isInteger(k));
  const removed = keywordIds.length
    ? await prisma.keywords.deleteMany({ where: { id: { in: keywordIds }, status: 'pending' } })
    : { count: 0 };
  await prisma.seo_strategies.delete({ where: { id: nid } });

  await activity.log('strategy.deleted', {
    entityType: 'seo_strategy',
    entityId: nid,
    details: `${existing.period} (${existing.status}); ${removed.count} unwritten keyword(s) removed`,
    actor: await getActor(),
  });
  return NextResponse.json({ ok: true, removedKeywords: removed.count }, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT };

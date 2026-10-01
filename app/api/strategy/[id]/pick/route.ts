import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { parseStrategyRow, pickBrief } from '@/lib/strategyPlanner';
import { createAudit } from '@/lib/audits';
import { findPostByUrl } from '@/lib/wordpress';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Acts on one pick of a strategy: a "new" pick goes into the blog pipeline with its brief; a
// refresh / consolidate / service-page pick gets a full audit of the existing URL, which then
// feeds the normal rewrite-and-approve flow in the Blog Audit tab.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);
  const { index, action }: any = (await req.json().catch(() => ({}))) || {};

  const row: any = await prisma.seo_strategies.findUnique({ where: { id: nid } });
  if (!row || !row.report_json) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  if (row.status === 'rejected' || row.status === 'superseded') {
    return NextResponse.json({ error: `This strategy is ${row.status}; act on the current one instead.` }, { status: 400 });
  }
  const report = JSON.parse(row.report_json);
  const pick = [...(report.picks || []), ...(report.quickEdits || []), ...(report.nextInLine || [])].find((p: any) => p.index === Number(index));
  if (!pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 });

  const save = async () => {
    await prisma.seo_strategies.update({ where: { id: nid }, data: { report_json: JSON.stringify(report) } });
    return NextResponse.json(parseStrategyRow(await prisma.seo_strategies.findUnique({ where: { id: nid } })), { status: 200 });
  };

  try {
    if (action === 'pipeline') {
      if (pick.status?.keywordId) return await save();
      if (!pick.keyword) return NextResponse.json({ error: 'This pick has no keyword.' }, { status: 400 });
      // Was: SELECT id FROM keywords WHERE lower(keyword) = lower(?) AND status IN (...) LIMIT 1
      const found: any[] = await prisma.$queryRaw`SELECT id FROM keywords WHERE lower(keyword) = lower(${pick.keyword}) AND status IN ('pending', 'generating', 'drafted') LIMIT 1`;
      const existing = found[0];
      const keywordId = existing
        ? Number(existing.id)
        : (
            await prisma.keywords.create({
              data: { batch_name: `Strategy ${row.period}`, keyword: pick.keyword, notes: await pickBrief(pick, row.period), status: 'pending' },
            })
          ).id;
      pick.status = { ...pick.status, keywordId };
      await activity.log('strategy.pick_queued', { entityType: 'keyword', entityId: keywordId, details: `"${pick.keyword}" from the ${row.period} strategy`, actor: await getActor() });
      return await save();
    }

    if (action === 'audit') {
      if (pick.status?.auditId) return await save();
      if (!pick.targetUrl) return NextResponse.json({ error: 'This pick has no existing URL to audit.' }, { status: 400 });
      const post: any = await findPostByUrl(pick.targetUrl).catch(() => null);
      const audit: any = post ? await createAudit({ wpPostId: post.id } as any) : await createAudit({ sourceUrl: pick.targetUrl } as any);
      pick.status = { ...pick.status, auditId: audit.id };
      await activity.log('strategy.pick_audited', { entityType: 'blog_audit', entityId: audit.id, details: `${pick.targetUrl} from the ${row.period} strategy`, actor: await getActor() });
      return await save();
    }

    return NextResponse.json({ error: 'action must be "pipeline" or "audit"' }, { status: 400 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

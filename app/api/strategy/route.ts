import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { approvalBlockers } from '@/lib/strategy/core';
import { latestCrawl } from '@/lib/strategy/service';
import { startStrategyJob, markInterrupted } from '@/lib/strategy/jobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

// Strategy v2. GET lists strategies (newest first) as light rows: period, status, version, live
// progress or the error. The page loads the one it shows through GET /api/strategy/[id] (the full
// 11-section view), so polling this list while a strategy generates costs two small queries.
// POST starts a generation for the 30 days from today, in the background, and returns at once;
// the page polls GET for progress.
export const runtime = 'nodejs';

export async function GET() {
  await markInterrupted();
  const [rows, crawl] = await Promise.all([
    prisma.seo_strategies.findMany({
      where: { OR: [{ plan_json: { not: null } }, { status: { in: ['generating', 'paused', 'stopping', 'stopped', 'failed'] } }] },
      orderBy: { id: 'desc' },
      take: 12,
      select: { id: true, period: true, status: true, version: true, created_at: true, approved_at: true, approved_by: true, progress_stage: true, progress_percent: true, error: true, plan_json: true, validation: true },
    }),
    latestCrawl(),
  ]);
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      period: r.period,
      status: r.status,
      version: r.version,
      created_at: r.created_at,
      approved_at: r.approved_at,
      approved_by: r.approved_by,
      hasPlan: Boolean(r.plan_json),
      blockers: r.plan_json && r.status !== 'approved' ? approvalBlockers(JSON.parse(r.plan_json), r.validation ? JSON.parse(r.validation) : null, crawl) : [],
      progress: { stage: r.progress_stage, percent: r.progress_percent },
      error: r.error,
    }))
  );
}

export async function POST() {
    try {
    const job = await startStrategyJob({ actor: await getActor() });
    return NextResponse.json(job, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { strategyView } from '@/lib/strategy/service';
import { startStrategyJob, markInterrupted } from '@/lib/strategy/jobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

// Strategy v2. GET lists strategies (newest first): finished ones in the 11-section view, plus any
// that are generating (with live progress) or failed (with the error).
// POST starts a generation for the 30 days from today, in the background, and returns at once;
// the page polls GET for progress.
export const runtime = 'nodejs';

export async function GET() {
  await markInterrupted();
  const rows = await prisma.seo_strategies.findMany({
    where: { OR: [{ plan_json: { not: null } }, { status: { in: ['generating', 'paused', 'stopping', 'stopped', 'failed'] } }] },
    orderBy: { id: 'desc' },
    take: 12,
  });
  const views: any[] = [];
  for (const r of rows) {
    if (r.plan_json) views.push(await strategyView(r));
    else views.push({ id: r.id, period: r.period, status: r.status, version: r.version, created_at: r.created_at, progress: { stage: r.progress_stage, percent: r.progress_percent }, error: r.error });
  }
  return NextResponse.json(views);
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

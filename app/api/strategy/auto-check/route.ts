// Daily cron: makes sure a strategy covers the coming days. When no strategy (generating, waiting
// for approval or approved) runs at least 3 more days, it generates a new one for the 30 days from
// today, in the background. GET without the cron secret only reports whether one is due.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startStrategyJob } from '@/lib/strategy/jobs';
import { strategyWindow } from '@/lib/strategy/core';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

async function covering() {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  return prisma.seo_strategies.findFirst({
    where: { status: { in: ['pending_review', 'approved', 'generating', 'paused'] }, end_date: { gte: soon } },
    select: { id: true, status: true, period: true },
    orderBy: { id: 'desc' },
  });
}

export async function GET(req: Request) {
  const window = strategyWindow();
  const found = await covering();
  if (!isCronRequest(req)) return NextResponse.json({ window, due: !found, existingId: found?.id || null });
  if (found) return NextResponse.json({ ran: false, reason: `Strategy #${found.id} (${found.period}, ${found.status}) already covers the coming days.` });
  const job = await startStrategyJob({ window, actor: 'Automatic run' });
  return NextResponse.json({ ran: true, window, id: job.id }, { status: 202 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

// Monthly cron (1st of the month): generates NEXT month's strategy in the background unless one
// already exists or is being generated. GET without the cron secret only reports whether it is due.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startStrategyJob } from '@/lib/strategy/jobs';
import { nextPeriod } from '@/lib/strategy/core';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

async function existing(period: string) {
  return prisma.seo_strategies.findFirst({ where: { period, status: { in: ['pending_review', 'approved', 'generating'] } }, select: { id: true, status: true } });
}

export async function GET(req: Request) {
  const period = nextPeriod();
  const found = await existing(period);
  if (!isCronRequest(req)) return NextResponse.json({ period, due: !found, existingId: found?.id || null });
  if (found) return NextResponse.json({ ran: false, period, reason: `The ${period} strategy already exists (#${found.id}, ${found.status}).` });
  const job = await startStrategyJob({ period, actor: 'Monthly auto-run' });
  return NextResponse.json({ ran: true, period, id: job.id }, { status: 202 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

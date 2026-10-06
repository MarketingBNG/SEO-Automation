// Monthly cron (1st of the month): generates NEXT month's strategy unless one already exists.
// GET without the cron secret only reports whether it is due.
import { NextResponse, after } from 'next/server';
import prisma from '@/lib/prisma';
import { generateStrategy } from '@/lib/strategy/generate';
import { nextPeriod } from '@/lib/strategy/core';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
// Only applies on Vercel (300 is its plan limit). The self-hosted Coolify server has no time limit.
export const maxDuration = 300;

async function existing(period: string) {
  return prisma.seo_strategies.findFirst({ where: { period, plan_json: { not: null }, status: { in: ['pending_review', 'approved'] } }, select: { id: true } });
}

export async function GET(req: Request) {
  const period = nextPeriod();
  const found = await existing(period);
  if (!isCronRequest(req)) return NextResponse.json({ period, due: !found, existingId: found?.id || null });
  if (found) return NextResponse.json({ ran: false, period, reason: `The ${period} strategy already exists (#${found.id}).` });
  // Runs after the response so the cron call returns quickly; maxDuration still bounds it.
  after(async () => {
    try {
      await generateStrategy({ period, actor: 'Monthly auto-run' });
    } catch (e: any) {
      console.error('Monthly strategy failed:', e);
    }
  });
  return NextResponse.json({ ran: true, period }, { status: 202 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

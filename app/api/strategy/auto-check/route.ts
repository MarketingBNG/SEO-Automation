// Monthly auto-run, safe to call as often as you like (a daily cron once deployed): generates the
// strategy only when there is none yet for the current month. GET just reports whether one is due.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createStrategy, currentPeriod } from '@/lib/strategyPlanner';
import { isCronRequest } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function findExisting() {
  const period = currentPeriod();
  const existing = await prisma.seo_strategies.findFirst({
    where: { period, status: { not: 'rejected' } },
    select: { id: true, status: true },
    orderBy: { id: 'desc' },
  });
  return { period, existing };
}

// PORT NOTE: Vercel Cron can only call with GET, so a GET carrying CRON_SECRET does what POST does.
// Every other GET (e.g. the dashboard) still only reports whether a strategy is due.
export async function GET(req: Request) {
  if (isCronRequest(req)) return POST();
  const { period, existing } = await findExisting();
  return NextResponse.json({ period, due: !existing, existingId: existing?.id || null }, { status: 200 });
}

export async function POST() {
  const { period, existing } = await findExisting();
  if (existing) return NextResponse.json({ ran: false, period, reason: `The ${period} strategy already exists (#${existing.id}).` }, { status: 200 });

  try {
    const id = await createStrategy({ period, actor: 'Monthly auto-run' });
    return NextResponse.json({ ran: true, period, id }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ ran: false, error: err.message }, { status: 500 });
  }
}

// Old handler computed the period lookup first, then 405 for other methods.
async function other() {
  await findExisting();
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
export { other as PUT, other as PATCH, other as DELETE };

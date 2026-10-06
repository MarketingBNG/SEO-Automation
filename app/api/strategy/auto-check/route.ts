// Monthly auto-run, safe to call as often as you like (a daily cron once deployed): generates the
// strategy only when there is none yet for the current month. GET just reports whether one is due.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createStrategy, currentPeriod } from '@/lib/strategyPlanner';
import { isCronRequest } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Runs through the Batch API (half price, can take up to hours), so the work continues in the
// background after the cron request gets its answer; this flag stops a duplicate run meanwhile.
let running = false;
const MAX_ATTEMPTS = 3;

// A failed attempt is retried straight away, up to MAX_ATTEMPTS in total.
async function runWithRetry(period) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await createStrategy({ period, actor: 'Monthly auto-run', batch: true });
    } catch (err: any) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      console.error(`Monthly strategy attempt ${attempt} failed, retrying:`, err.message);
    }
  }
}

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

  if (running) return NextResponse.json({ ran: false, period, reason: 'The monthly strategy is already being generated.' }, { status: 200 });
  running = true;
  runWithRetry(period)
    .catch((err: any) => console.error('Monthly strategy auto-run failed:', err))
    .finally(() => { running = false; });
  return NextResponse.json({ ran: true, started: true, period, mode: 'batch' }, { status: 202 });
}

// Old handler computed the period lookup first, then 405 for other methods.
async function other() {
  await findExisting();
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
export { other as PUT, other as PATCH, other as DELETE };

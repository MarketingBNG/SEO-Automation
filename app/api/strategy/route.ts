import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateStrategy } from '@/lib/strategy/generate';
import { strategyView } from '@/lib/strategy/service';
import { nextPeriod } from '@/lib/strategy/core';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

// Strategy v2. GET lists strategies (newest first) in the 11-section view.
// POST generates one now (streamed progress); the monthly cron does the same on the 1st.
export const runtime = 'nodejs';
// Only applies on Vercel (300 is its plan limit). The self-hosted Coolify server has no time limit.
export const maxDuration = 300;

export async function GET() {
  const rows = await prisma.seo_strategies.findMany({ where: { plan_json: { not: null } }, orderBy: { id: 'desc' }, take: 12 });
  const views: any[] = [];
  for (const r of rows) views.push(await strategyView(r));
  return NextResponse.json(views);
}

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const actor = await getActor();
  const controller = new AbortController();
  req.signal.addEventListener('abort', () => controller.abort());
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) => {
        try {
          ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        } catch {}
      };
      try {
        const id = await generateStrategy({
          period: body?.period || nextPeriod(),
          actor,
          signal: controller.signal,
          onProgress: (stage: string, percent: number) => send({ stage, percent }),
        });
        send({ status: 'done', id });
      } catch (err: any) {
        await activity.log('strategy.generation_failed', { entityType: 'seo_strategy', details: err.message, actor });
        send({ status: 'error', error: err.message });
      } finally {
        try {
          ctrl.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform' } });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

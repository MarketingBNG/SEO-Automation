import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createStrategy, parseStrategyRow } from '@/lib/strategyPlanner';
import * as activity from '@/lib/activity';
import { methodNotAllowed } from '../_lib/http';

// Generation takes several minutes (live Google checks plus web research), so it streams
// newline-delimited JSON progress like blog generation, and closing the request stops it.
export const runtime = 'nodejs';
export const maxDuration = 800;

export async function GET() {
  const rows = await prisma.seo_strategies.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows.map((r: any) => parseStrategyRow(r)), { status: 200 });
}

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));

  const controller = new AbortController();
  let finished = false;
  // Client went away (e.g. the Stop button aborted the fetch) -> stop generation.
  req.signal.addEventListener('abort', () => {
    if (!finished) controller.abort();
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      let closed = false;
      const send = (obj: any) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };

      (async () => {
        send({ stage: 'Starting…', percent: 2 });
        try {
          const id = await createStrategy({
            period: body?.period || undefined,
            signal: controller.signal,
            onProgress: (stage: any, percent: any) => send({ stage, percent }),
          });
          const row = await prisma.seo_strategies.findUnique({ where: { id: Number(id) } });
          send({ status: 'done', percent: 100, stage: 'Done', result: parseStrategyRow(row) });
        } catch (err: any) {
          if (controller.signal.aborted || err.name === 'AbortError' || err.name === 'APIUserAbortError') {
            await activity.log('strategy.generation_stopped', { entityType: 'seo_strategy', details: 'Stopped by user' });
            send({ status: 'stopped', stage: 'Stopped by user' });
          } else {
            console.error(err);
            await activity.log('strategy.generation_failed', { entityType: 'seo_strategy', details: err.message });
            send({ status: 'error', stage: 'Failed', error: err.message });
          }
        } finally {
          finished = true;
          if (!closed) {
            closed = true;
            try {
              ctrl.close();
            } catch {}
          }
        }
      })();
    },
    cancel() {
      if (!finished) controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

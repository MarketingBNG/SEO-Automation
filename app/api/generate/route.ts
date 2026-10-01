import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { researchAndWriteBlog } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { methodNotAllowed } from '../_lib/http';

// Streams newline-delimited JSON progress events over the same connection instead of a single
// buffered response, so the UI can show real progress and the user can stop generation by simply
// closing the request (aborting the fetch) - no separate job store needed, and it stays
// deploy-friendly (a background job surviving after the response is sent would not work once this
// runs as a Vercel serverless function).
export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

// Claims the oldest pending keyword atomically: two concurrent requests can't both pick the same one.
async function claimNextPending(): Promise<any | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await prisma.keywords.findFirst({ where: { status: 'pending' }, orderBy: { id: 'asc' } });
    if (!candidate) return null;
    const res = await prisma.keywords.updateMany({ where: { id: candidate.id, status: 'pending' }, data: { status: 'generating' } });
    if (res.count === 1) return { ...candidate, status: 'generating' };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { keywordId }: any = (await req.json().catch(() => ({}))) || {};

  let keyword: any;
  if (keywordId) {
    const n = Number(keywordId);
    keyword = Number.isSafeInteger(n) ? await prisma.keywords.findUnique({ where: { id: n } }) : null;
    if (keyword) {
      // Atomic claim: a keyword already being generated (another tab, double-click) is not started twice.
      const r = await prisma.keywords.updateMany({ where: { id: keyword.id, status: { not: 'generating' } }, data: { status: 'generating' } });
      if (r.count !== 1) return NextResponse.json({ error: 'This keyword is already being generated' }, { status: 409 });
    }
  } else {
    keyword = await claimNextPending();
  }

  if (!keyword) return NextResponse.json({ error: 'No pending keyword found' }, { status: 404 });

  const controller = new AbortController();
  let finished = false;
  // The client going away (e.g. the Stop button aborted the fetch) signals stop.
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
          const result: any = await researchAndWriteBlog(keyword.keyword, keyword.notes, {
            signal: controller.signal,
            onProgress: (stage: any, percent: any) => send({ stage, percent }),
          });

          const draft = await prisma.drafts.create({
            data: {
              keyword_id: keyword.id,
              title: result.title,
              meta_description: result.meta,
              content_html: result.content,
              research_notes: result.researchNotes,
              production_state: result.productionState,
              repair_attempts: result.repairAttempts,
              validation_issues: JSON.stringify(result.validation.issues),
              validation_warnings: JSON.stringify(result.validation.warnings || []),
              word_count: result.validation.wordCount,
              people_also_ask: JSON.stringify(result.peopleAlsoAsk || []),
              keyword_plan: JSON.stringify(result.keywordPlan || null),
              status: 'pending_review',
            },
          });

          const draftId = draft.id;

          for (const fact of result.facts) {
            await prisma.facts.create({
              data: {
                draft_id: draftId,
                fact_id: fact.fact_id,
                claim: fact.claim,
                source_name: fact.source_name,
                source_url: fact.source_url,
                jurisdiction: fact.jurisdiction,
                effective_date: fact.effective_date,
                status: 'needs_verify',
              },
            });
          }

          await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'drafted' } });

          await activity.log('draft.generated', {
            entityType: 'draft',
            entityId: draftId,
            details: `"${result.title}" for keyword "${keyword.keyword}": ${result.productionState}, ${result.repairAttempts} repair attempt(s)`,
          });

          send({
            status: 'done',
            percent: 100,
            stage: 'Done',
            result: {
              keyword: keyword.keyword,
              title: result.title,
              productionState: result.productionState,
              repairAttempts: result.repairAttempts,
              issues: result.validation.issues,
              draftId,
            },
          });
        } catch (err: any) {
          if (controller.signal.aborted || err.name === 'AbortError' || err.name === 'APIUserAbortError') {
            await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'pending' } }).catch((e) => console.error(e));
            await activity.log('draft.generation_stopped', {
              entityType: 'keyword',
              entityId: keyword.id,
              details: `"${keyword.keyword}": stopped by user`,
            });
            send({ status: 'stopped', stage: 'Stopped by user' });
          } else {
            console.error(err);
            await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'failed', error: err.message } }).catch((e) => console.error(e));
            await activity.log('draft.generation_failed', {
              entityType: 'keyword',
              entityId: keyword.id,
              details: `"${keyword.keyword}": ${err.message}`,
            });
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
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

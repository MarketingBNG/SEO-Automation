import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { researchAndWriteBlog } from '@/lib/anthropic';
import { startTimer, endTimer } from '@/lib/jobTimer';
import * as activity from '@/lib/activity';
import { progressWriter } from '@/lib/strategy/jobs';
import { methodNotAllowed } from '../_lib/http';
import { blogRuns } from '@/lib/blogRuns';

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

  // The run belongs to the server, not to the browser tab: closing the tab, a dropped connection or a
  // proxy timeout no longer stops it. Only the Stop button (POST /api/generate/stop) does.
  const controller = new AbortController();
  blogRuns.set(keyword.id, controller);

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
        // Also saved on the keyword row, so the header progress bar shows it on every tab.
        const saveProgress = progressWriter((stage, percent) =>
          prisma.keywords.update({ where: { id: keyword.id }, data: { progress_stage: stage, progress_percent: percent } })
        );
        // Long steps (deep research, fact checks) can take many minutes with no new stage. Every
        // 20 seconds: keep the connection alive and show the elapsed time, so it never looks stuck.
        let lastStage = 'Starting…';
        let lastPercent = 2;
        let stageSince = Date.now();
        const beat = setInterval(() => {
          const mins = Math.floor((Date.now() - stageSince) / 60000);
          const stage = mins >= 1 ? `${lastStage} (${mins} min so far, still working)` : lastStage;
          send({ stage, percent: lastPercent });
          saveProgress(stage, lastPercent);
        }, 20000);

        startTimer(`blog-${keyword.id}`, 'blog', `Blog: ${keyword.keyword}`);
        try {
          const result: any = await researchAndWriteBlog(keyword.keyword, keyword.notes, {
            signal: controller.signal,
            onProgress: (stage: any, percent: any) => {
              if (stage !== lastStage) stageSince = Date.now();
              lastStage = stage;
              lastPercent = percent;
              send({ stage, percent });
              saveProgress(stage, percent);
            },
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
              linkedin_post: result.linkedin || null,
              length_target: result.lengthTarget ? JSON.stringify(result.lengthTarget) : null,
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

          await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'drafted', progress_stage: null, progress_percent: null } });
          await endTimer(`blog-${keyword.id}`, true);

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
            await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'pending', progress_stage: null, progress_percent: null } }).catch((e) => console.error(e));
            await activity.log('draft.generation_stopped', {
              entityType: 'keyword',
              entityId: keyword.id,
              details: `"${keyword.keyword}": stopped by user`,
            });
            send({ status: 'stopped', stage: 'Stopped by user' });
          } else if (err?.name === 'CreditPausedError' || /out of credit|credit balance is too low/i.test(err?.message || '')) {
            // Not the keyword's fault: keep it in the queue so it runs again after a top-up.
            await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'pending', error: err.message, progress_stage: null, progress_percent: null } }).catch((e) => console.error(e));
            send({ status: 'error', stage: 'Paused', error: `${err.message} The keyword stays in the queue.` });
          } else {
            console.error(err);
            await prisma.keywords.update({ where: { id: keyword.id }, data: { status: 'failed', error: err.message, progress_stage: null, progress_percent: null } }).catch((e) => console.error(e));
            await activity.log('draft.generation_failed', {
              entityType: 'keyword',
              entityId: keyword.id,
              details: `"${keyword.keyword}": ${err.message}`,
            });
            send({ status: 'error', stage: 'Failed', error: err.message });
          }
        } finally {
          clearInterval(beat);
          blogRuns.delete(keyword.id);
          await endTimer(`blog-${keyword.id}`, false);
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
      // The browser stopped reading; the run carries on and saves its progress and draft.
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

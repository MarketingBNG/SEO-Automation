// Writes one blog for one keyword on the server: research, draft, checks, save. Used by the
// Keywords tab ("Generate next blog draft", which streams progress to the browser) and by the
// scheduler, which restarts a blog that a server restart (for example a deploy) cut off.
// The run belongs to the server: closing the tab or losing the connection does not stop it; only the
// Stop button (its AbortController in blogRuns) does.
import prisma from './prisma';
import { researchAndWriteBlog } from './anthropic';
import { startTimer, endTimer, setStage, timerFor } from './jobTimer';
import * as activity from './activity';
import { progressWriter } from './strategy/jobs';
import { blogRuns } from './blogRuns';
import { authorNames, pickAuthor } from './authors';
import { startedAt } from './jobTimer';

export async function runBlogJob(keyword: any, controller: AbortController, send: (evt: any) => void = () => {}) {
  blogRuns.set(keyword.id, controller);
  send({ stage: 'Starting…', percent: 2 });
  // Also saved on the keyword row, so the header progress bar shows it on every tab.
  const saveProgress = progressWriter((stage, percent) =>
    prisma.keywords.update({ where: { id: keyword.id }, data: { progress_stage: stage, progress_percent: percent } })
  );
  // Long steps (deep research, fact checks) report their real activity (searches done, words
  // written). Every 20 seconds the heartbeat adds when the AI last sent anything, so the screen says
  // "last reply 8 s ago" or "no reply for 3 min" instead of claiming "still working" blindly.
  const timerKey = `blog-${keyword.id}`;
  const idleMin = Math.round(Math.max(60000, Number(process.env.CLAUDE_IDLE_TIMEOUT_MS) || 5 * 60 * 1000) / 60000);
  let lastStage = 'Starting…';
  let lastPercent = 2;
  let stageSince = Date.now();
  const beat = setInterval(() => {
    const last = timerFor(timerKey)?.stage?.lastActivityAt;
    let note = '';
    if (last) {
      const ago = Math.round((Date.now() - last) / 1000);
      note = ago < 120 ? `last reply from the AI ${ago} s ago` : `no reply from the AI for ${Math.floor(ago / 60)} min; it reconnects on its own after ${idleMin} min of silence`;
    } else {
      const mins = Math.floor((Date.now() - stageSince) / 60000);
      note = mins >= 1 ? `${mins} min on this step` : '';
    }
    const stage = note ? `${lastStage} (${note})` : lastStage;
    send({ stage, percent: lastPercent });
    saveProgress(stage, lastPercent);
  }, 20000);

  startTimer(timerKey, 'blog', `Blog: ${keyword.keyword}`);
  try {
    const result: any = await researchAndWriteBlog(keyword.keyword, keyword.notes, {
      signal: controller.signal,
      onProgress: (stage: any, percent: any, extra?: any) => {
        if (stage !== lastStage) stageSince = Date.now();
        lastStage = stage;
        lastPercent = percent;
        if (extra?.key) setStage(timerKey, extra.key, { progress: extra.progress, round: extra.round, lastActivityAt: extra.lastActivityAt ?? null, label: stage });
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
        // The partner it will be published under is fixed now, so previews match the live post.
        author: pickAuthor(await authorNames()),
        status: 'pending_review',
      },
    });
    // Plagiarism check in the background, so the result is ready when someone reviews the draft.
    void import('./originality').then((m) => m.checkDraftOriginality(draft.id)).catch(() => {});

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
  }
}

// Restarts, one at a time, a blog whose run was cut off by a server restart. Called by the scheduler.
export async function resumeInterruptedBlog() {
  if (blogRuns.size) return null;
  const k = await prisma.keywords.findFirst({ where: { status: 'pending', error: { startsWith: 'The previous run was cut off' } }, orderBy: { id: 'asc' } });
  if (!k) return null;
  const claimed = await prisma.keywords.updateMany({ where: { id: k.id, status: 'pending' }, data: { status: 'generating', error: null } });
  if (claimed.count !== 1) return null;
  await activity.log('draft.generation_resumed', { entityType: 'keyword', entityId: k.id, details: `"${k.keyword}" restarted automatically after a server restart` });
  void runBlogJob({ ...k, status: 'generating' }, new AbortController()).catch((e) => console.error('Resumed blog failed:', e.message));
  return k.keyword;
}

// A blog marked "generating" with no live run in this server was cut off by a restart. Blogs from the
// strategy are written again by the schedule; the rest go back in the queue and resumeInterruptedBlog
// starts them again. Without `immediate`, a run must look orphaned for over a minute first, so one
// that is just starting is left alone; at server start every "generating" blog is orphaned.
const g = globalThis as unknown as { __orphanSeen?: Map<number, number> };
const seen = (g.__orphanSeen ||= new Map<number, number>());

export async function requeueOrphanBlogs({ immediate = false } = {}) {
  let n = 0;
  for (const k of await prisma.keywords.findMany({ where: { status: 'generating' }, select: { id: true, batch_name: true } })) {
    if (blogRuns.has(k.id) || startedAt(`blog-${k.id}`)) {
      seen.delete(k.id);
      continue;
    }
    if (!immediate) {
      if (!seen.has(k.id)) seen.set(k.id, Date.now());
      if (Date.now() - (seen.get(k.id) as number) < 60000) continue;
    }
    seen.delete(k.id);
    const fromStrategy = String(k.batch_name || '').startsWith('Strategy #');
    await prisma.keywords
      .update({
        where: { id: k.id },
        data: {
          status: fromStrategy ? 'failed' : 'pending',
          error: fromStrategy ? 'Cut off by a server restart; the monthly schedule writes it again automatically.' : 'The previous run was cut off by a server restart.',
          progress_stage: null,
          progress_percent: null,
        },
      })
      .catch(() => {});
    n++;
  }
  return n;
}

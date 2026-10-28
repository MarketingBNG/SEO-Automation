// Background jobs with live progress saved in the database, so long work (several minutes of
// research) never depends on one browser request staying open. The page and the header progress
// bar read the progress with short polls.
//
// Strategy generation can be paused, resumed and stopped from the dashboard:
//  - Pause: the run waits at its next checkpoint (between steps) until resumed.
//  - Stop: the run is cancelled at once (a running Claude request is aborted too).
// A paused run that the server lost (restart) starts again from the beginning when resumed.
import { withReplay, clearReplay } from '../aiReplay';
import prisma from '../prisma';
import * as activity from '../activity';
import { generateStrategy } from './generate';
import { strategyWindow, type StrategyWindow } from './core';
import { assertCredits, CreditPausedError, isCreditError } from '../aiCredits';
import { recordDuration } from '../jobTimer';

// Writes progress at most every 2 seconds (and always for 100%).
export function progressWriter(write: (stage: string, percent: number) => Promise<unknown>) {
  let last = 0;
  let lastStage = '';
  return (stage: string, percent: number) => {
    const now = Date.now();
    // A new stage is always saved; repeated updates of the same stage at most every 2 seconds.
    if (percent < 100 && stage === lastStage && now - last < 2000) return;
    last = now;
    lastStage = stage;
    write(String(stage).slice(0, 300), Math.max(0, Math.min(100, Math.round(percent)))).catch(() => {});
  };
}

const ACTIVE = ['generating', 'paused', 'stopping'];
// Set on a run cut off by a server restart; the scheduler starts it again (resumeRestarted).
const RESTART_PAUSED = 'Paused: the server restarted. It starts again by itself (finished steps are kept).';
// Runs alive in this server process, so Stop can abort them immediately. Kept on globalThis so
// every route (each may load its own copy of this module) sees the same list.
const g = globalThis as unknown as { __strategyRuns?: Map<number, AbortController> };
const running = (g.__strategyRuns ||= new Map<number, AbortController>());
// When each run started in this server process (for the time-left estimate).
const gs = globalThis as unknown as { __strategyStarted?: Map<number, number> };
export const strategyStarted = (gs.__strategyStarted ||= new Map<number, number>());

// True while this server process is running the strategy (the sweep must not call it stuck).
export const strategyRunning = (id: number) => running.has(id);

const stopError = () => Object.assign(new Error('Stopped by user'), { name: 'AbortError' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Waits while the job is paused; throws when it was stopped.
async function checkpointFor(id: number, controller: AbortController) {
  for (;;) {
    if (controller.signal.aborted) throw stopError();
    const row = await prisma.seo_strategies.findUnique({ where: { id }, select: { status: true } });
    if (!row || row.status === 'stopping' || row.status === 'stopped') throw stopError();
    if (row.status !== 'paused') return;
    await sleep(3000);
  }
}

function run(id: number, window: StrategyWindow, actor: string) {
  const controller = new AbortController();
  running.set(id, controller);
  strategyStarted.set(id, Date.now());
  const onProgress = progressWriter((stage, percent) =>
    // Only while generating: a paused run keeps its "Paused: ..." stage, which the resume logic looks for.
    prisma.seo_strategies.updateMany({ where: { id, status: 'generating' }, data: { progress_stage: stage, progress_percent: percent } })
  );
  // Detached on purpose: the self-hosted server keeps running it after the request returns.
  const began = Date.now();
  // Finished AI steps are saved, so Resume after a credit stop or a restart reuses them (lib/aiReplay.ts).
  void withReplay(`strategy-${id}`, () => generateStrategy({ window, actor, rowId: id, onProgress, signal: controller.signal, checkpoint: () => checkpointFor(id, controller) }))
    .then(async () => {
      await clearReplay(`strategy-${id}`);
      recordDuration('strategy', (Date.now() - began) / 1000);
    })
    .catch(async (err: any) => {
      // Credits ran low: keep the run paused (not failed) so Resume starts it again after a top-up.
      if (err instanceof CreditPausedError || isCreditError(err)) {
        await prisma.seo_strategies.update({ where: { id }, data: { status: 'paused', progress_stage: 'Paused: AI credits low. It starts again by itself when credits are back (finished steps are kept).' } }).catch(() => {});
        return;
      }
      const stopped = controller.signal.aborted || err?.name === 'AbortError' || err?.name === 'APIUserAbortError' || /stopped by user/i.test(err?.message || '');
      if (stopped) {
        await clearReplay(`strategy-${id}`);
        await prisma.seo_strategies.update({ where: { id }, data: { status: 'stopped', progress_stage: 'Stopped' } }).catch(() => {});
        await activity.log('strategy.generation_stopped', { entityType: 'seo_strategy', entityId: id, actor });
        return;
      }
      console.error('Strategy generation failed:', err);
      await prisma.seo_strategies.update({ where: { id }, data: { status: 'failed', error: String(err.message || err).slice(0, 2000), progress_stage: 'Failed' } }).catch(() => {});
      await activity.log('strategy.generation_failed', { entityType: 'seo_strategy', entityId: id, details: err.message, actor });
    })
    .finally(() => running.delete(id));
}

// Starts generating a strategy for the 30 days from today, in the background; returns the row id.
export async function startStrategyJob({ window = strategyWindow(), actor = 'system' }: { window?: StrategyWindow; actor?: string } = {}) {
  const active = await prisma.seo_strategies.findFirst({ where: { status: { in: ACTIVE } }, select: { id: true } });
  if (active) return { id: active.id, alreadyRunning: true };
  const row = await prisma.seo_strategies.create({
    data: { period: window.label, start_date: window.start, end_date: window.end, status: 'generating', progress_stage: 'Starting', progress_percent: 1 },
  });
  run(row.id, window, actor);
  return { id: row.id, alreadyRunning: false };
}

// A 'generating' row that no run in this server is working on was cut off by a restart or
// redeploy: mark it failed so the page says so and a new one can be started.
export async function markInterrupted() {
  const rows = await prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'stopping'] } }, select: { id: true, status: true } });
  for (const r of rows) {
    if (running.has(r.id)) continue;
    await prisma.seo_strategies.update({
      where: { id: r.id },
      data:
        r.status === 'stopping'
          ? { status: 'stopped', progress_stage: 'Stopped' }
          : { status: 'paused', progress_stage: RESTART_PAUSED },
    });
  }
}

// Pause, resume or stop a generating strategy.
export async function controlStrategyJob(id: number, action: 'pause' | 'resume' | 'stop', actor = 'system') {
  const row = await prisma.seo_strategies.findUnique({ where: { id } });
  if (!row || !ACTIVE.includes(row.status)) throw Object.assign(new Error('This strategy is not being generated.'), { status: 409 });
  if (action === 'pause') {
    await prisma.seo_strategies.update({ where: { id }, data: { status: 'paused' } });
  } else if (action === 'resume') {
    await assertCredits(); // throws a clear message while AI work is paused for credits
    await prisma.seo_strategies.update({ where: { id }, data: { status: 'generating' } });
    // The server lost this run (restart): start it again from the beginning.
    if (!running.has(id)) {
      const window = { start: row.start_date, end: row.end_date, label: row.period } as StrategyWindow;
      await prisma.seo_strategies.update({ where: { id }, data: { progress_stage: 'Restarting', progress_percent: 1 } });
      // Checked again right before starting, with no await in between: two resumes at the same time
      // (Resume pressed twice, or Resume during the scheduler's resume) start only one run.
      if (!running.has(id)) run(id, window.start ? window : strategyWindow(), actor);
    }
  } else {
    await prisma.seo_strategies.update({ where: { id }, data: { status: 'stopping', progress_stage: 'Stopping' } });
    const c = running.get(id);
    if (c) c.abort();
    else await prisma.seo_strategies.update({ where: { id }, data: { status: 'stopped', progress_stage: 'Stopped' } });
  }
  await activity.log(`strategy.generation_${action}`, { entityType: 'seo_strategy', entityId: id, actor });
  return prisma.seo_strategies.findUnique({ where: { id } });
}

// Starts again the runs cut off by a server restart (called by the scheduler), unless AI work is
// paused for credits; then autoResumeAi does it when credits are back.
export async function resumeRestarted() {
  const rows = await prisma.seo_strategies.findMany({ where: { status: 'paused', progress_stage: RESTART_PAUSED }, select: { id: true } });
  for (const r of rows) await controlStrategyJob(r.id, 'resume', 'automatic (after a server restart)').catch((e: any) => console.error('Strategy restart failed:', e.message));
}

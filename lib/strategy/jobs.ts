// Background jobs with live progress saved in the database, so long work (several minutes of
// research) never depends on one browser request staying open. The page and the header progress
// bar read the progress with short polls.
import prisma from '../prisma';
import * as activity from '../activity';
import { generateStrategy } from './generate';
import { nextPeriod } from './core';

// Writes progress at most every 2 seconds (and always for 100%).
export function progressWriter(write: (stage: string, percent: number) => Promise<unknown>) {
  let last = 0;
  return (stage: string, percent: number) => {
    const now = Date.now();
    if (percent < 100 && now - last < 2000) return;
    last = now;
    write(String(stage).slice(0, 300), Math.max(0, Math.min(100, Math.round(percent)))).catch(() => {});
  };
}

// Starts generating a strategy in the background and returns its row id right away.
export async function startStrategyJob({ period = nextPeriod(), actor = 'system' }: { period?: string; actor?: string } = {}) {
  const running = await prisma.seo_strategies.findFirst({ where: { status: 'generating' }, select: { id: true } });
  if (running) return { id: running.id, alreadyRunning: true };
  const row = await prisma.seo_strategies.create({ data: { period, status: 'generating', progress_stage: 'Starting', progress_percent: 1 } });
  const onProgress = progressWriter((stage, percent) =>
    prisma.seo_strategies.update({ where: { id: row.id }, data: { progress_stage: stage, progress_percent: percent } })
  );
  // Detached on purpose: the self-hosted server keeps running it after the request returns.
  void generateStrategy({ period, actor, rowId: row.id, onProgress }).catch(async (err: any) => {
    console.error('Strategy generation failed:', err);
    await prisma.seo_strategies.update({ where: { id: row.id }, data: { status: 'failed', error: String(err.message || err).slice(0, 2000), progress_stage: 'Failed' } }).catch(() => {});
    await activity.log('strategy.generation_failed', { entityType: 'seo_strategy', entityId: row.id, details: err.message, actor });
  });
  return { id: row.id, alreadyRunning: false };
}

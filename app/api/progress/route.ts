import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { markInterrupted, strategyStarted } from '@/lib/strategy/jobs';
import { eta, etaFor, runningTimers, startedAt, timerFor } from '@/lib/jobTimer';
import { requeueOrphanBlogs } from '@/lib/blogJob';
import * as settings from '@/lib/settings';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Everything running right now, with live progress: strategy generation and blog writing.
// Polled by the progress bar in the dashboard header.
export async function GET() {
  await markInterrupted();
  await requeueOrphanBlogs();
  const [strategies, blogs] = await Promise.all([
    prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'paused', 'stopping'] } }, select: { id: true, period: true, status: true, progress_stage: true, progress_percent: true } }),
    prisma.keywords.findMany({ where: { status: 'generating' }, select: { id: true, keyword: true, progress_stage: true, progress_percent: true, created_at: true } }),
  ]);
  const ms = (s: string) => Date.parse(String(s).replace(' ', 'T') + 'Z');
  const withEta = async (kind: any, start: number, percent: number, paused = false) => (paused ? {} : { startedAt: new Date(start).toISOString(), ...(await eta(kind, start, percent)) });
  const strategyJobs = await Promise.all(
    strategies.map(async (s) => ({ kind: 'strategy', id: s.id, label: `Strategy for ${s.period}`, stage: s.status === 'paused' ? 'Paused' : s.status === 'stopping' ? 'Stopping' : s.progress_stage || 'Starting', paused: s.status === 'paused', percent: s.progress_percent ?? 0, ...(await withEta('strategy', strategyStarted.get(s.id) ?? Date.now(), s.progress_percent ?? 0, s.status === 'paused')) }))
  );
  // Blogs report their steps, so the estimate is per step (rest of this step + the steps to come).
  const blogJobs = await Promise.all(
    blogs.map(async (k) => {
      const t = timerFor(`blog-${k.id}`);
      const start = startedAt(`blog-${k.id}`) ?? Math.max(ms(k.created_at), Date.now() - 3 * 3600000);
      const est = t?.stage ? await etaFor(t) : await withEta('blog', start, k.progress_percent ?? 0);
      return { kind: 'blog', id: k.id, label: `Blog: ${k.keyword}`, stage: k.progress_stage || 'Starting', percent: k.progress_percent ?? 0, startedAt: new Date(start).toISOString(), ...est };
    })
  );
  // Other timed work (fact checks, rewrites, guides, refreshes): no percent, so time-based only.
  const otherJobs = await Promise.all(
    runningTimers()
      .filter((t) => !t.key.startsWith('blog-'))
      .map(async (t) => ({ kind: t.kind, id: t.key, label: t.label, stage: 'Working', percent: null, ...(await withEta(t.kind, t.startedAt, 0)) }))
  );
  const aiPaused = (await settings.get('ai_paused')) === '1';
  const stamp = `${await settings.get('credit_balance_set_at')}|${await settings.get('credit_balance_usd')}`;
  const credits80 = !aiPaused && (await settings.get('credit_alert_80_for')) === stamp;
  return NextResponse.json({
    aiPaused,
    credits80,
    aiPausedReason: aiPaused ? await settings.get('ai_paused_reason') : null,
    jobs: [...strategyJobs, ...blogJobs, ...otherJobs],
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

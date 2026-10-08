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
// The two clean-up checks (runs lost to a restart) need to happen now and then, not on every poll
// from every open browser tab.
const g = globalThis as unknown as { __progressCleanupAt?: number };
export async function GET() {
  if (Date.now() - (g.__progressCleanupAt || 0) > 60000) {
    g.__progressCleanupAt = Date.now();
    await markInterrupted();
    await requeueOrphanBlogs();
  }
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
  const st = await settings.getMany(['ai_paused', 'ai_paused_reason', 'credit_balance_set_at', 'credit_balance_usd', 'credit_alert_80_for']);
  const aiPaused = st.ai_paused === '1';
  const stamp = `${st.credit_balance_set_at}|${st.credit_balance_usd}`;
  const credits80 = !aiPaused && st.credit_alert_80_for === stamp;
  // Finished (or failed) in the last 15 minutes: audits, rewrites, blogs, publishes.
  const since = new Date(Date.now() - 15 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const done = await prisma.activity_log.findMany({
    where: { created_at: { gte: since }, action: { in: ['audit.completed', 'audit.failed', 'audit.rewritten', 'audit.rewrite_failed', 'draft.generated', 'draft.generation_failed', 'schedule.published', 'schedule.failed', 'wordpress.published', 'strategy.generated', 'strategy.failed'] } },
    orderBy: { id: 'desc' },
    take: 6,
    select: { id: true, action: true, details: true },
  });
  const recent = done.map((d) => ({
    id: d.id,
    ok: !/failed/.test(d.action),
    kind: d.action.startsWith('audit') ? 'audit' : d.action.startsWith('draft') ? 'blog' : d.action.startsWith('strategy') ? 'strategy' : 'strategy',
    label: `${{ 'audit.completed': 'Audit finished', 'audit.failed': 'Audit', 'audit.rewritten': 'Rewrite ready to review', 'audit.rewrite_failed': 'Rewrite', 'draft.generated': 'Blog written, waiting for review', 'draft.generation_failed': 'Blog', 'schedule.published': 'Blog published', 'schedule.failed': 'Blog', 'wordpress.published': 'Published to WordPress', 'strategy.generated': 'Strategy ready', 'strategy.failed': 'Strategy' }[d.action] || d.action}: ${String(d.details || '').slice(0, 120)}`,
  }));
  return NextResponse.json({
    recent,
    aiPaused,
    credits80,
    aiPausedReason: aiPaused ? st.ai_paused_reason : null,
    jobs: [...strategyJobs, ...blogJobs, ...otherJobs],
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

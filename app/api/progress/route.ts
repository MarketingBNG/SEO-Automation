import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { markInterrupted, strategyStarted } from '@/lib/strategy/jobs';
import { eta, runningTimers, startedAt } from '@/lib/jobTimer';
import { blogRuns } from '@/lib/blogRuns';
import * as settings from '@/lib/settings';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Everything running right now, with live progress: strategy generation and blog writing.
// Polled by the progress bar in the dashboard header.
export async function GET() {
  await markInterrupted();
  // A blog cut off by a server restart (for example a deploy) goes back in the queue instead of
  // staying "generating" for ever; the next "Generate next blog draft" writes it again.
  // Only after it has had no live run for over a minute, so a run that is just starting is left alone.
  const g = globalThis as unknown as { __orphanSeen?: Map<number, number> };
  const seen = (g.__orphanSeen ||= new Map<number, number>());
  for (const k of await prisma.keywords.findMany({ where: { status: 'generating' }, select: { id: true } })) {
    if (blogRuns.has(k.id) || startedAt(`blog-${k.id}`)) {
      seen.delete(k.id);
      continue;
    }
    if (!seen.has(k.id)) seen.set(k.id, Date.now());
    if (Date.now() - (seen.get(k.id) as number) < 60000) continue;
    seen.delete(k.id);
    await prisma.keywords.update({ where: { id: k.id }, data: { status: 'pending', error: 'The previous run was cut off by a server restart.', progress_stage: null, progress_percent: null } }).catch(() => {});
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
  const blogJobs = await Promise.all(
    blogs.map(async (k) => ({ kind: 'blog', id: k.id, label: `Blog: ${k.keyword}`, stage: k.progress_stage || 'Starting', percent: k.progress_percent ?? 0, ...(await withEta('blog', startedAt(`blog-${k.id}`) ?? ms(k.created_at), k.progress_percent ?? 0)) }))
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

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { markInterrupted } from '@/lib/strategy/jobs';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Everything running right now, with live progress: strategy generation and blog writing.
// Polled by the progress bar in the dashboard header.
export async function GET() {
  await markInterrupted();
  const [strategies, blogs] = await Promise.all([
    prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'paused', 'stopping'] } }, select: { id: true, period: true, status: true, progress_stage: true, progress_percent: true } }),
    prisma.keywords.findMany({ where: { status: 'generating' }, select: { id: true, keyword: true, progress_stage: true, progress_percent: true } }),
  ]);
  return NextResponse.json({
    jobs: [
      ...strategies.map((s) => ({ kind: 'strategy', id: s.id, label: `Strategy for ${s.period}`, stage: s.status === 'paused' ? 'Paused' : s.status === 'stopping' ? 'Stopping' : s.progress_stage || 'Starting', paused: s.status === 'paused', percent: s.progress_percent ?? 0 })),
      ...blogs.map((k) => ({ kind: 'blog', id: k.id, label: `Blog: ${k.keyword}`, stage: k.progress_stage || 'Starting', percent: k.progress_percent ?? 0 })),
    ],
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sqlNowOffset } from '@/lib/time';

export const runtime = 'nodejs';

// Replaces the old process-startup reset in lib/db.js: a keyword can be left stuck in 'generating'
// (and an assistant conversation in 'running') if the function that was handling it was killed.
// Serverless has no "fresh process start", so this cron sweeps rows that have been stuck for 15+
// minutes instead. Auth (CRON_SECRET) is enforced in proxy.ts.
export async function GET() {
  const cutoff = sqlNowOffset('-15 minutes');

  // keywords only have created_at: treat as stuck when created 15+ min ago and no draft for it was
  // created in the last 15 minutes (a generation that just finished would have one).
  const stuck = await prisma.keywords.findMany({
    where: {
      status: 'generating',
      created_at: { lt: cutoff },
      drafts: { none: { created_at: { gte: cutoff } } },
    },
    select: { id: true },
  });
  const kw = stuck.length
    ? await prisma.keywords.updateMany({
        where: { id: { in: stuck.map((k) => k.id) }, status: 'generating' },
        data: { status: 'pending' },
      })
    : { count: 0 };

  const awaiting = await prisma.assistant_conversations.updateMany({
    where: { status: 'running', updated_at: { lt: cutoff }, pending: { not: null } },
    data: { status: 'awaiting_approval' },
  });
  const idle = await prisma.assistant_conversations.updateMany({
    where: { status: 'running', updated_at: { lt: cutoff }, pending: null },
    data: { status: 'idle' },
  });

  return NextResponse.json({
    keywordsReset: kw.count,
    conversationsAwaitingApproval: awaiting.count,
    conversationsIdle: idle.count,
  });
}

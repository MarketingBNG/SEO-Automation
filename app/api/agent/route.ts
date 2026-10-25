import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// The Testing mode queue (lib/aiQueue.ts), answered by Claude Code on the owner's subscription with
// scripts/agent.ts. Reached with the Claude Code edit token (lib/draftToken.ts) or a signed-in session.

// GET: the waiting jobs, oldest first, with the full request.
export async function GET() {
  const jobs = await prisma.ai_jobs.findMany({ where: { status: 'waiting' }, orderBy: { id: 'asc' }, take: 50 });
  return NextResponse.json({
    jobs: jobs.map((j) => ({ id: j.id, feature: j.feature, model: j.model, label: j.label, web_search: j.web_search, created_at: j.created_at, system: j.system, messages: JSON.parse(j.messages) })),
  });
}

// POST { id, answer }: the reply, written exactly in the format the request asks for.
export async function POST(req: NextRequest) {
  const { id, answer }: any = (await req.json().catch(() => ({}))) || {};
  if (!Number.isSafeInteger(Number(id)) || typeof answer !== 'string' || !answer.trim()) return NextResponse.json({ error: 'Send { id, answer } with the reply text.' }, { status: 400 });
  const r = await prisma.ai_jobs.updateMany({ where: { id: Number(id), status: 'waiting' }, data: { status: 'answered', answer, answered_by: 'Claude Code', answered_at: sqlNow() } });
  if (!r.count) return NextResponse.json({ error: 'No waiting job with that id (it was answered or cancelled).' }, { status: 404 });
  const job = await prisma.ai_jobs.findUnique({ where: { id: Number(id) }, select: { feature: true } });
  await activity.log('ai_queue.answered', { entityType: 'ai_job', entityId: Number(id), details: `Job #${id} (${job?.feature}) answered by Claude Code on the subscription`, actor: 'Claude Code' });
  return NextResponse.json({ ok: true });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

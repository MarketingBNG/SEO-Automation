// Write a blog: claiming a keyword to write, stopping a run, putting a failed keyword back. Shared by
// /api/generate, /api/generate/stop, /api/keywords/[id]/retry and the assistant's tools.
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { blogRuns } from '@/lib/blogRuns';

type Result = { status: number; body: any };

// Claims the oldest pending keyword atomically: two concurrent requests can't both pick the same one.
async function claimNextPending(): Promise<any | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    // Calendar blogs ('Strategy #') are written by their schedule, never as a separate blog here.
    const candidate = await prisma.keywords.findFirst({ where: { status: 'pending', OR: [{ batch_name: null }, { NOT: { batch_name: { startsWith: 'Strategy #' } } }] }, orderBy: { id: 'asc' } });
    if (!candidate) return null;
    const res = await prisma.keywords.updateMany({ where: { id: candidate.id, status: 'pending' }, data: { status: 'generating' } });
    if (res.count === 1) return { ...candidate, status: 'generating' };
  }
  return null;
}

// Why a chosen keyword cannot be written now, or null when it can (pending or failed, not a calendar blog).
export function generationRefusal(k: { status: string; batch_name?: string | null }): string | null {
  if (k.status === 'generating') return 'This keyword is already being generated';
  if (String(k.batch_name || '').startsWith('Strategy #')) return 'This blog is on the Monthly Strategy calendar, which writes it by itself. Use its calendar row instead.';
  if (!['pending', 'failed'].includes(k.status)) return `This keyword is already written (status ${k.status}); its draft is in Drafts & Review. Add it again as a new keyword only if a second blog is really wanted.`;
  return null;
}

// The keyword a new run writes (claimed: status 'generating'), or the error the route answers.
export async function claimKeywordForGeneration(keywordId?: unknown): Promise<{ keyword: any } | { error: Result }> {
  let keyword: any;
  if (keywordId) {
    const n = Number(keywordId);
    keyword = Number.isSafeInteger(n) ? await prisma.keywords.findUnique({ where: { id: n } }) : null;
    if (keyword) {
      // A chosen keyword is written only while it waits to be written (pending) or failed. One already
      // written (drafted) or on the Monthly Strategy calendar ('Strategy #', written by its schedule)
      // would become a second, paid copy. Atomic: another tab or a double-click cannot start it twice.
      const why = generationRefusal(keyword);
      if (why) return { error: { status: 409, body: { error: why } } };
      const r = await prisma.keywords.updateMany({ where: { id: keyword.id, status: { in: ['pending', 'failed'] }, OR: [{ batch_name: null }, { NOT: { batch_name: { startsWith: 'Strategy #' } } }] }, data: { status: 'generating' } });
      if (r.count !== 1) return { error: { status: 409, body: { error: 'This keyword is already being generated' } } };
    }
  } else {
    keyword = await claimNextPending();
  }
  if (!keyword) return { error: { status: 404, body: { error: 'No pending keyword found' } } };
  return { keyword };
}

// Stops one blog generation. Other people's blogs (Topics, resumed runs) keep going, so a request
// without a keyword id is refused. Who pressed Stop is logged here: the run's own 'stopped' row
// names whoever started it.
export async function stopGeneration(keywordId: unknown, actor: string): Promise<Result> {
  const id = Number(keywordId);
  if (!keywordId || !Number.isSafeInteger(id)) return { status: 400, body: { error: 'Say which blog to stop (keywordId).' } };
  let stopped = 0;
  const c = blogRuns.get(id);
  if (c) {
    c.abort();
    stopped++;
    await activity.log('draft.generation_stop_requested', { entityType: 'keyword', entityId: id, details: 'Stop pressed', actor }).catch(() => {});
  }
  return { status: 200, body: { stopped } };
}

// Puts a failed keyword back in the queue, so "Generate next blog draft" writes it again.
export async function retryKeyword(id: number, actor: string): Promise<Result> {
  const k = await prisma.keywords.findUnique({ where: { id } });
  if (!k) return { status: 404, body: { error: 'Not found' } };
  if (k.status !== 'failed') return { status: 409, body: { error: 'Only a failed keyword can be retried.' } };
  // A calendar blog is written again by its schedule (Monthly Strategy); a retry here would write a
  // second, separate copy of it.
  if (String(k.batch_name || '').startsWith('Strategy #')) return { status: 409, body: { error: 'This blog is on the Monthly Strategy calendar, which writes it again by itself. Use Resume or Reschedule on its calendar row instead.' } };
  await prisma.keywords.update({ where: { id }, data: { status: 'pending', error: null, progress_stage: null, progress_percent: null } });
  await activity.log('keywords.retry', { entityType: 'keyword', entityId: id, details: `"${k.keyword}" put back in the queue`, actor });
  return { status: 200, body: { ok: true } };
}

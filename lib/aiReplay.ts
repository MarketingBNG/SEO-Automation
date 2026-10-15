// Saves the finished AI steps of a long run (a blog or a monthly strategy), so a run that stopped
// half-way (credits ran out, server restart) and is started again does not pay for them twice.
// Inside withReplay(scope, fn) every Claude call with the same request as before returns the saved
// answer at once; the first new or failed step is the one that runs again. The saved steps are
// deleted when the run finishes, so writing the same keyword again later is a fresh run.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import prisma from './prisma';

// run: this attempt. Only answers saved by an earlier attempt are reused, so a retry inside the same
// attempt (for example after a malformed answer) still asks the AI again.
const store = new AsyncLocalStorage<{ scope: string; run: string }>();

export function withReplay<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ scope, run: `${Date.now()}-${Math.random()}` }, fn);
}

export const replayScope = () => store.getStore() || null;

export const requestHash = (req: unknown) => createHash('sha256').update(JSON.stringify(req)).digest('hex');

export async function savedStep(scope: string, hash: string): Promise<any | null> {
  const row = await prisma.ai_replay.findUnique({ where: { scope_hash: { scope, hash } } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.result);
  } catch {
    return null;
  }
}

export async function saveStep(scope: string, hash: string, result: any) {
  const data = JSON.stringify(result);
  await prisma.ai_replay.upsert({ where: { scope_hash: { scope, hash } }, create: { scope, hash, result: data }, update: { result: data } }).catch((e) => console.error('ai_replay save failed:', e.message));
}

export async function clearReplay(scope: string) {
  await prisma.ai_replay.deleteMany({ where: { scope } }).catch(() => {});
}

// Steps of runs nobody started again within 14 days.
export async function pruneReplay() {
  const before = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  await prisma.ai_replay.deleteMany({ where: { created_at: { lt: before } } }).catch(() => {});
}

// After credits are back: restarts the strategies paused for credits and the blogs that stopped for
// credits (one blog at a time; the scheduler picks up the next one on its next tick).
export async function resumeCreditPaused(): Promise<string | null> {
  const done: string[] = [];
  const { controlStrategyJob } = await import('./strategy/jobs');
  for (const s of await prisma.seo_strategies.findMany({ where: { status: 'paused', OR: [{ progress_stage: { startsWith: 'Paused: AI credits' } }, { progress_stage: { startsWith: 'Paused: the server restarted' } }] }, select: { id: true, period: true } })) {
    await controlStrategyJob(s.id, 'resume', 'automatic (credits available again)').then(() => done.push(`strategy ${s.period}`)).catch((e) => console.error('Strategy resume failed:', e.message));
  }
  const blog = await resumeCreditBlog();
  if (blog) done.push(`blog "${blog}"`);
  return done.length ? done.join(', ') : null;
}

export async function resumeCreditBlog(): Promise<string | null> {
  const { blogRuns } = await import('./blogRuns');
  if (blogRuns.size) return null;
  const k = await prisma.keywords.findFirst({ where: { status: 'pending', OR: [{ error: { contains: 'credit' } }, { error: { contains: 'AI work is paused' } }] }, orderBy: { id: 'asc' } });
  if (!k) return null;
  const claimed = await prisma.keywords.updateMany({ where: { id: k.id, status: 'pending' }, data: { status: 'generating', error: null } });
  if (claimed.count !== 1) return null;
  const { runBlogJob } = await import('./blogJob');
  const activity = await import('./activity');
  await activity.log('draft.generation_resumed', { entityType: 'keyword', entityId: k.id, details: `"${k.keyword}" started again by itself after AI credits came back; finished steps are reused` });
  void runBlogJob({ ...k, status: 'generating' }, new AbortController()).catch((e) => console.error('Resumed blog failed:', e.message));
  return k.keyword;
}

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
// counts: how many times each frozen input was asked for in this attempt (see frozenInput).
const store = new AsyncLocalStorage<{ scope: string; run: string; counts?: Record<string, number> }>();

export function withReplay<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ scope, run: `${Date.now()}-${Math.random()}`, counts: {} }, fn);
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

// The live inputs of a run's prompts (a research brief, today's date, the strategy data), saved on
// the first attempt and read back on later ones. Rebuilt from live data, they would differ a little
// (a ranking moved, a source timed out, a new day) and every later step would miss its saved answer.
// Outside a resumable run it simply builds the value. each: an input read again later in the run that
// may have changed meanwhile (the fact-check memory between rounds) is saved once per read, in order.
export async function frozenInput<T>(name: string, build: () => Promise<T>, { each = false } = {}): Promise<T> {
  const ctx = replayScope();
  if (!ctx) return build();
  let hash = `input:${name}`;
  if (each && ctx.counts) {
    ctx.counts[name] = (ctx.counts[name] || 0) + 1;
    hash += `#${ctx.counts[name]}`;
  }
  // A blog's saved input older than FROZEN_MAX_DAYS is built again: a blog started again weeks later
  // (after a Stop, or a failure left pending) works from today's brief and date, not the old ones.
  // A strategy keeps its request for its whole run (its period is fixed, and it is paused on purpose).
  const row = await prisma.ai_replay.findUnique({ where: { scope_hash: { scope: ctx.scope, hash } } }).catch(() => null);
  if (row && (ctx.scope.startsWith('strategy-') || !isStale(row.created_at))) {
    try {
      const saved = JSON.parse(row.result);
      if (saved && 'value' in saved) return saved.value;
    } catch {}
  }
  const value = await build();
  if (value !== undefined) {
    const data = JSON.stringify({ run: ctx.run, value });
    await prisma.ai_replay
      .upsert({ where: { scope_hash: { scope: ctx.scope, hash } }, create: { scope: ctx.scope, hash, result: data }, update: { result: data, created_at: sqlNow() } })
      .catch((e) => console.error('ai_replay save failed:', e.message));
  }
  return value;
}

export const FROZEN_MAX_DAYS = 3;
const isStale = (createdAt: string) => Date.now() - Date.parse(String(createdAt).replace(' ', 'T') + 'Z') > FROZEN_MAX_DAYS * 86400000;
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Today's date (UTC) as the run first saw it, so a run resumed after midnight asks the same questions.
export const runToday = () => frozenInput('today', async () => new Date().toISOString().slice(0, 10));

export async function clearReplay(scope: string) {
  await prisma.ai_replay.deleteMany({ where: { scope } }).catch(() => {});
}

// Steps of runs nobody started again within 14 days. A run still waiting to resume keeps its steps
// however long the wait: a blog left pending for credits, a pause or a restart (not one a person
// stopped), a strategy paused or generating, and a calendar blog not yet written or published (its
// writer steps and its fact checks).
export async function pruneReplay() {
  const before = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  try {
    const waiting = ['credit', 'paused', 'cut off'].map((w) => ({ error: { contains: w, mode: 'insensitive' as const } }));
    const [blogs, strategies, rows] = await Promise.all([
      prisma.keywords.findMany({ where: { OR: [{ status: 'generating' }, { status: 'pending', OR: waiting }] }, select: { id: true } }),
      prisma.seo_strategies.findMany({ where: { status: { in: ['paused', 'generating'] } }, select: { id: true } }),
      prisma.blog_schedule.findMany({ where: { status: { notIn: ['published', 'failed'] } }, select: { id: true, draft_id: true } }),
    ]);
    const live = [...blogs.map((k) => `blog-${k.id}`), ...strategies.map((s) => `strategy-${s.id}`), ...rows.map((r) => `blog-sched-${r.id}`)];
    const checks = rows.filter((r) => r.draft_id).map((r) => ({ scope: { startsWith: `factcheck-${r.draft_id}-` } }));
    await prisma.ai_replay.deleteMany({ where: { created_at: { lt: before }, scope: { notIn: live }, ...(checks.length ? { NOT: { OR: checks } } : {}) } });
    // Batch ids saved by runBatchTurn whose request never came back (a batch is reused for a week).
    const batches = await prisma.settings.findMany({ where: { key: { startsWith: 'batch_pending:' } } });
    const old = batches.filter((b) => {
      try {
        return b.value.startsWith('{') && Date.now() - JSON.parse(b.value).at > 7 * 86400000;
      } catch {
        return false;
      }
    });
    if (old.length) await prisma.settings.deleteMany({ where: { key: { in: old.map((b) => b.key) } } });
  } catch {}
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

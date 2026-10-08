// Live timers for anything that takes a while: when it started, which step it is on and how far
// that step has got (from real work: web searches done, words written), how long each step usually
// takes (the last 10 runs, saved in settings), and an honest estimate of the time left. Running jobs
// are kept on globalThis so every route sees them; the header bar reads them through /api/progress.
import * as settings from './settings';
import { etaSeconds, blendEta } from './strategy/core';

export type JobKind = 'blog' | 'strategy' | 'fact-check' | 'rewrite' | 'guide' | 'refresh' | 'competitors' | 'keywords' | 'lessons';

// First-run estimates (seconds) until the dashboard has measured its own.
const DEFAULT_SECONDS: Record<string, number> = {
  blog: 40 * 60,
  strategy: 30 * 60,
  'fact-check': 20 * 60,
  rewrite: 45 * 60,
  guide: 75,
  refresh: 10 * 60,
  competitors: 4 * 60,
  keywords: 3 * 60,
  lessons: 2 * 60,
};

// The steps of a blog run, in order, with first-run estimates. A repair round repeats write and
// check. Measured durations are kept per step under "stage:blog.write" and so on.
export const STAGES: Record<string, { key: string; label: string; typical: number }[]> = {
  blog: [
    { key: 'brief', label: 'Gathering data', typical: 90 },
    { key: 'plan', label: 'Keyword plan', typical: 15 },
    { key: 'write', label: 'Research and writing', typical: 20 * 60 },
    { key: 'validate', label: 'Writing rules', typical: 10 },
    { key: 'check', label: 'Fact check', typical: 15 * 60 },
    { key: 'save', label: 'Saving', typical: 10 },
  ],
};

// Repair rounds repeat write and check with a smaller budget, so their durations are kept apart.
const REPAIR_DEFAULTS: Record<string, number> = { 'write.repair': 8 * 60, 'check.repair': 15 * 60 };
export const stageKeyFor = (stageKey: string, round: number) => (round > 0 && (stageKey === 'write' || stageKey === 'check') ? `${stageKey}.repair` : stageKey);

export type Stage = { key: string; startedAt: number; progress: number; round: number; lastActivityAt: number | null; label?: string };
type Running = { key: string; kind: JobKind; label: string; startedAt: number; stage?: Stage };
const g = globalThis as unknown as { __jobTimers?: Map<string, Running> };
const running = (g.__jobTimers ||= new Map<string, Running>());

// The measured durations, read once per half minute (the progress bar asks for estimates every few
// seconds, for every step of every running job).
let historyCache: { at: number; value: Record<string, number[]> } | null = null;
async function history(): Promise<Record<string, number[]>> {
  if (historyCache && Date.now() - historyCache.at < 30000) return historyCache.value;
  let value: Record<string, number[]> = {};
  try {
    value = JSON.parse((await settings.get('job_durations')) || '{}');
  } catch {
    value = {};
  }
  historyCache = { at: Date.now(), value };
  return value;
}

const stageDefault = (kind: string, stageKey: string) => REPAIR_DEFAULTS[stageKey] ?? STAGES[kind]?.find((s) => s.key === stageKey)?.typical ?? 600;

// The usual duration of a job kind ("blog") or of one step ("stage:blog.write"): the median of the
// last 10 measured runs, or the first-run estimate.
export async function typicalSeconds(kind: string): Promise<number> {
  const list = (await history())[kind] || [];
  if (!list.length) {
    const m = kind.match(/^stage:([^.]+)\.(.+)$/);
    return m ? stageDefault(m[1], m[2]) : DEFAULT_SECONDS[kind] ?? 600;
  }
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function recordDuration(kind: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 5) return;
  const h = await history();
  h[kind] = [...(h[kind] || []), Math.round(seconds)].slice(-10);
  historyCache = { at: Date.now(), value: h };
  await settings.set('job_durations', JSON.stringify(h)).catch(() => {});
}

export function startTimer(key: string, kind: JobKind, label: string) {
  if (!running.has(key)) running.set(key, { key, kind, label, startedAt: Date.now() });
  return running.get(key)!;
}

// Moves a job to a step (or updates the step's progress). When the step changes, the finished
// step's duration teaches the estimate for next time.
export function setStage(key: string, stageKey: string, { progress = 0, round = 0, lastActivityAt = null, label }: { progress?: number; round?: number; lastActivityAt?: number | null; label?: string } = {}) {
  const r = running.get(key);
  if (!r) return;
  const now = Date.now();
  if (!r.stage || r.stage.key !== stageKey || r.stage.round !== round) {
    if (r.stage) void recordDuration(`stage:${r.kind}.${stageKeyFor(r.stage.key, r.stage.round)}`, (now - r.stage.startedAt) / 1000);
    r.stage = { key: stageKey, startedAt: now, progress: 0, round, lastActivityAt: null };
  }
  r.stage.progress = Math.max(r.stage.progress, Math.min(1, Math.max(0, progress || 0)));
  if (lastActivityAt) r.stage.lastActivityAt = lastActivityAt;
  if (label) r.stage.label = label;
}

// Ends a timer; a job that finished normally teaches the estimate for next time.
export async function endTimer(key: string, ok = true) {
  const r = running.get(key);
  running.delete(key);
  if (r && ok) {
    await recordDuration(r.kind, (Date.now() - r.startedAt) / 1000);
    if (r.stage) await recordDuration(`stage:${r.kind}.${stageKeyFor(r.stage.key, r.stage.round)}`, (Date.now() - r.stage.startedAt) / 1000);
  }
}

// Runs fn with a live timer around it.
export async function timed<T>(key: string, kind: JobKind, label: string, fn: () => Promise<T>): Promise<T> {
  startTimer(key, kind, label);
  try {
    const out = await fn();
    await endTimer(key, true);
    return out;
  } catch (e) {
    await endTimer(key, false);
    throw e;
  }
}

export const startedAt = (key: string) => running.get(key)?.startedAt ?? null;
export const runningTimers = () => [...running.values()];
export const timerFor = (key: string) => running.get(key) ?? null;

// Seconds left for one job without step information, from its pace and the usual duration.
export async function eta(kind: string, startedAtMs: number, percent: number) {
  const elapsed = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const typical = await typicalSeconds(kind);
  return { elapsed: Math.round(elapsed), remaining: etaSeconds({ elapsed, percent, typical }), typical, overdue: elapsed > typical * 1.25 && percent < 90 };
}

// Seconds left for a job that reports steps: the rest of the current step (from its real progress
// and its usual duration) plus the usual duration of every step still to come. A step that has run
// well past its usual time is marked overdue, so the screen says so instead of inventing a number.
export async function etaFor(r: Running) {
  const now = Date.now();
  const elapsed = Math.max(0, (now - r.startedAt) / 1000);
  if (!r.stage || !STAGES[r.kind]) return eta(r.kind, r.startedAt, 0);
  const order = STAGES[r.kind];
  const idx = Math.max(0, order.findIndex((s) => s.key === r.stage!.key));
  const round = r.stage.round;
  const typicalCur = await typicalSeconds(`stage:${r.kind}.${stageKeyFor(r.stage.key, round)}`);
  const stageElapsed = Math.max(0, (now - r.stage.startedAt) / 1000);
  const p = r.stage.progress;
  const remainingCur = blendEta({ elapsed: stageElapsed, progress: p, typical: typicalCur });
  let later = 0;
  for (const s of order.slice(idx + 1)) later += await typicalSeconds(`stage:${r.kind}.${stageKeyFor(s.key, round)}`);
  const ifRepair = (await typicalSeconds(`stage:${r.kind}.write.repair`)) + (await typicalSeconds(`stage:${r.kind}.check.repair`));
  return {
    elapsed: Math.round(elapsed),
    remaining: Math.round(remainingCur + later),
    typical: Math.round(typicalCur + later),
    stageKey: r.stage.key,
    stageLabel: order[idx]?.label || r.stage.key,
    stageElapsed: Math.round(stageElapsed),
    stageTypical: Math.round(typicalCur),
    stageProgress: Math.round(p * 100),
    round: r.stage.round,
    overdue: stageElapsed > typicalCur * 1.25 && p < 0.9,
    lastActivityAgo: r.stage.lastActivityAt ? Math.round((now - r.stage.lastActivityAt) / 1000) : null,
    ifRepair: Math.round(ifRepair),
  };
}

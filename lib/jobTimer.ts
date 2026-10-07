// Live timers for anything that takes a while: when it started, how long this kind of job usually
// takes (the last 10 runs, saved in settings), and an estimate of the time left. Running jobs are
// kept on globalThis so every route sees them; the header bar reads them through /api/progress.
import * as settings from './settings';
import { etaSeconds } from './strategy/core';

export type JobKind = 'blog' | 'strategy' | 'fact-check' | 'rewrite' | 'guide' | 'refresh' | 'competitors' | 'keywords' | 'lessons';

// First-run estimates (seconds) until the dashboard has measured its own.
const DEFAULT_SECONDS: Record<JobKind, number> = {
  blog: 25 * 60,
  strategy: 30 * 60,
  'fact-check': 12 * 60,
  rewrite: 30 * 60,
  guide: 75,
  refresh: 10 * 60,
  competitors: 4 * 60,
  keywords: 3 * 60,
  lessons: 2 * 60,
};

type Running = { key: string; kind: JobKind; label: string; startedAt: number };
const g = globalThis as unknown as { __jobTimers?: Map<string, Running> };
const running = (g.__jobTimers ||= new Map<string, Running>());

async function history(): Promise<Record<string, number[]>> {
  try {
    return JSON.parse((await settings.get('job_durations')) || '{}');
  } catch {
    return {};
  }
}

export async function typicalSeconds(kind: JobKind): Promise<number> {
  const list = (await history())[kind] || [];
  if (!list.length) return DEFAULT_SECONDS[kind];
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function recordDuration(kind: JobKind, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 5) return;
  const h = await history();
  h[kind] = [...(h[kind] || []), Math.round(seconds)].slice(-10);
  await settings.set('job_durations', JSON.stringify(h)).catch(() => {});
}

export function startTimer(key: string, kind: JobKind, label: string) {
  if (!running.has(key)) running.set(key, { key, kind, label, startedAt: Date.now() });
  return running.get(key)!;
}

// Ends a timer; a job that finished normally teaches the estimate for next time.
export async function endTimer(key: string, ok = true) {
  const r = running.get(key);
  running.delete(key);
  if (r && ok) await recordDuration(r.kind, (Date.now() - r.startedAt) / 1000);
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

// Seconds left for one job, from its own pace and the typical duration of its kind.
export async function eta(kind: JobKind, startedAtMs: number, percent: number) {
  const elapsed = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const typical = await typicalSeconds(kind);
  return { elapsed: Math.round(elapsed), remaining: etaSeconds({ elapsed, percent, typical }), typical };
}

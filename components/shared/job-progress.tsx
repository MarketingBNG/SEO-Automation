'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Countdown } from './countdown';

export const JOBS_CHANGED = 'growth-center:jobs-changed';
// Call after starting background work so the header bar picks it up without waiting for the next poll.
export function jobsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED));
}

// Live progress bars for work running in the background (strategy generation, blog writing),
// shown under the dashboard header on every tab. Polls /api/progress every 5 seconds while
// something runs, every 20 seconds when nothing does, and not at all while the browser tab is
// hidden (the countdown between polls ticks locally).
export function JobProgress({ onOpen }: { onOpen?: (kind: string) => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState<number>(() => {
    try {
      return Number(sessionStorage.getItem('jobs:dismissed') || 0);
    } catch {
      return 0;
    }
  });
  const [paused, setPaused] = useState<string | null>(null);
  const [credits80, setCredits80] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    const tick = async () => {
      if (stop) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      let running = false;
      if (!busy) {
        busy = true;
        const j = await fetch('/api/progress').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        busy = false;
        if (stop) return;
        if (j) {
          setJobs(j.jobs || []);
          setRecent(j.recent || []);
          setPaused(j.aiPaused ? j.aiPausedReason || 'AI credits are low.' : null);
          setCredits80(Boolean(j.credits80));
          running = (j.jobs || []).length > 0;
        }
      }
      timer = setTimeout(tick, running ? 5000 : 20000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    // A page that starts work (a blog, a strategy, a publish) fires this so the bar shows it at once.
    const onChanged = () => {
      if (timer) clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(JOBS_CHANGED, onChanged);
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(JOBS_CHANGED, onChanged);
    };
  }, []);

  const finished = recent.filter((r) => r.id > dismissed);
  if (!jobs.length && !paused && !credits80 && !finished.length) return null;
  const dismiss = () => {
    const top = Math.max(0, ...recent.map((r) => r.id));
    setDismissed(top);
    try {
      sessionStorage.setItem('jobs:dismissed', String(top));
    } catch {}
  };
  return (
    <div className="space-y-1.5 border-b bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
      {paused && (
        <button type="button" onClick={() => onOpen?.('settings')} className="block w-full rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-left text-xs">
          <strong>AI work is paused:</strong> {paused} Open Settings &gt; AI credits to add the new balance.
        </button>
      )}
      {credits80 && (
        <button type="button" onClick={() => onOpen?.('settings')} className="block w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-left text-xs">
          <strong>AI credits: 80% of the balance is used.</strong> Top up at console.anthropic.com, then enter the new balance in Settings &gt; AI credits.
        </button>
      )}
      {/* Work that finished in the last 15 minutes, so nobody has to wonder whether it happened. */}
      {finished.length > 0 && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs">
          {finished.slice(0, 3).map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen?.(r.kind)} className="text-left">
              <span className={r.ok ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>{r.ok ? 'Done' : 'Failed'}:</span> {r.label}
            </button>
          ))}
          <button type="button" onClick={dismiss} className="ml-auto text-muted-foreground underline">Hide</button>
        </div>
      )}
      {jobs.map((j) => (
        <button key={`${j.kind}-${j.id}`} type="button" onClick={() => onOpen?.(j.kind)} className="block w-full text-left">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className={`size-3.5 shrink-0 ${j.paused ? "" : "animate-spin"}`} />
            <span className="truncate font-medium">{j.label}</span>
            <span className="truncate text-muted-foreground">{j.stage}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
              {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} overdue={j.overdue} typical={j.typical} stageElapsed={j.stageElapsed} stageTypical={j.stageTypical} stageLabel={j.stageLabel} ifRepair={j.ifRepair} className="hidden sm:inline" />}
              {j.percent !== null && j.percent !== undefined && <span>{j.percent}%</span>}
            </span>
          </div>
          {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} overdue={j.overdue} typical={j.typical} stageElapsed={j.stageElapsed} stageTypical={j.stageTypical} stageLabel={j.stageLabel} ifRepair={j.ifRepair} className="block text-[11px] sm:hidden" />}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {j.percent !== null && j.percent !== undefined ? (
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.max(2, j.percent)}%` }} />
            ) : (
              <div className="h-full rounded-full bg-primary/60 transition-all duration-700" style={{ width: `${Math.min(95, Math.max(4, ((j.elapsed || 0) / Math.max(1, (j.elapsed || 0) + (j.remaining || 1))) * 100))}%` }} />
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

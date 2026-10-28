'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, Square } from 'lucide-react';
import { Countdown } from './countdown';
import { useRole } from '@/hooks/use-role';

export const JOBS_CHANGED = 'growth-center:jobs-changed';
// Call after starting background work so the header bar picks it up without waiting for the next poll.
export function jobsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED));
}

// Background jobs that have a Stop button (audits and rewrites from "Check a blog").
const STOPPABLE = /^(audit|rewrite)-\d+$/;

// Live progress bars for work running in the background (strategy generation, blog writing),
// shown under the dashboard header on every tab. Polls /api/progress every 5 seconds while
// something runs, every 20 seconds when nothing does, and not at all while the browser tab is
// hidden (the countdown between polls ticks locally).
export function JobProgress({ onOpen }: { onOpen?: (kind: string) => void }) {
  // Stopping an audit or rewrite needs content.work (POST /api/audit/stop).
  const canStop = useRole().can('content.work');
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
  const [stopping, setStopping] = useState<string | null>(null);
  const [testing, setTesting] = useState<{ on: boolean; waiting: number }>({ on: false, waiting: 0 });

  async function stopJob(j: any) {
    if (!window.confirm(`Stop "${j.label}" now? It will not finish, and you can run it again later.`)) return;
    setStopping(j.id);
    try {
      const r = await fetch('/api/audit/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: j.id }) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) window.alert(json.error || 'Could not stop it.');
    } finally {
      setStopping(null);
      jobsChanged();
    }
  }

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
          setTesting({ on: Boolean(j.testing), waiting: j.waitingForClaudeCode || 0 });
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
  if (!jobs.length && !paused && !credits80 && !finished.length && !testing.on) return null;
  const dismiss = () => {
    const top = Math.max(0, ...recent.map((r) => r.id));
    setDismissed(top);
    try {
      sessionStorage.setItem('jobs:dismissed', String(top));
    } catch {}
  };
  return (
    <div className="space-y-1.5 border-b bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
      {testing.on && (
        <button type="button" onClick={() => onOpen?.('settings')} className="flex w-fit items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-0.5 text-left text-xs font-medium text-amber-800 dark:text-amber-300">
          <FlaskConical className="size-3.5" />
          TESTING · runs on Claude Code subscription, no API credits
          {testing.waiting > 0 && <span className="font-normal">· {testing.waiting} waiting for Claude Code</span>}
        </button>
      )}
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
        <div
          key={`${j.kind}-${j.id}`}
          role="button"
          tabIndex={0}
          onClick={() => onOpen?.(j.kind)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen?.(j.kind)}
          className="block w-full cursor-pointer text-left"
        >
          <div className="flex items-center gap-2 text-xs">
            {/* Gold pulse while working, like the Social Media dashboard; still when paused. */}
            <span className="relative flex size-2.5 shrink-0">
              {!j.paused && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#E8B04B] opacity-75" />}
              <span className="relative inline-flex size-2.5 rounded-full bg-[#E8B04B]" />
            </span>
            <span className="truncate font-medium">{j.label}</span>
            <span className="truncate text-muted-foreground">{j.stage}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
              {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} overdue={j.overdue} typical={j.typical} stageElapsed={j.stageElapsed} stageTypical={j.stageTypical} stageLabel={j.stageLabel} ifRepair={j.ifRepair} className="hidden sm:inline" />}
              {j.percent !== null && j.percent !== undefined && <span>{j.percent}%</span>}
              {canStop && STOPPABLE.test(String(j.id)) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stopJob(j);
                  }}
                  disabled={stopping === j.id}
                  className="flex items-center gap-1 rounded-md border border-red-500/40 px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  title="Stop this job now. The AI call in flight is cut off, so no more credits are spent on it."
                >
                  <Square className="size-3 fill-current" />
                  {stopping === j.id ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </span>
          </div>
          {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} overdue={j.overdue} typical={j.typical} stageElapsed={j.stageElapsed} stageTypical={j.stageTypical} stageLabel={j.stageLabel} ifRepair={j.ifRepair} className="block text-[11px] sm:hidden" />}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {/* Navy-to-gold bar with a moving shine, the same design as the Social Media dashboard. */}
            <div
              className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-[#1B2A5E] via-[#E8B04B] to-[#F6D58E] shadow-[0_0_8px_rgba(232,176,75,0.6)] transition-all duration-700"
              style={{ width: `${j.percent !== null && j.percent !== undefined ? Math.max(2, j.percent) : Math.min(95, Math.max(4, ((j.elapsed || 0) / Math.max(1, (j.elapsed || 0) + (j.remaining || 1))) * 100))}%` }}
            >
              {!j.paused && <span className="absolute inset-0 animate-[shine_1.2s_linear_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

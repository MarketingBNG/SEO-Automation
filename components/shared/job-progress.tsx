'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Countdown } from './countdown';

// Live progress bars for work running in the background (strategy generation, blog writing),
// shown under the dashboard header on every tab. Polls /api/progress every 4 seconds.
export function JobProgress({ onOpen }: { onOpen?: (kind: string) => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [paused, setPaused] = useState<string | null>(null);
  const [credits80, setCredits80] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const j = await fetch('/api/progress').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!stop && j) {
        setJobs(j.jobs || []);
        setPaused(j.aiPaused ? j.aiPausedReason || 'AI credits are low.' : null);
        setCredits80(Boolean(j.credits80));
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!jobs.length && !paused && !credits80) return null;
  return (
    <div className="space-y-1.5 border-b bg-muted/30 px-3 py-2 sm:px-4">
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
      {jobs.map((j) => (
        <button key={`${j.kind}-${j.id}`} type="button" onClick={() => onOpen?.(j.kind)} className="block w-full text-left">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className={`size-3.5 shrink-0 ${j.paused ? "" : "animate-spin"}`} />
            <span className="truncate font-medium">{j.label}</span>
            <span className="truncate text-muted-foreground">{j.stage}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
              {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} className="hidden sm:inline" />}
              {j.percent !== null && j.percent !== undefined && <span>{j.percent}%</span>}
            </span>
          </div>
          {!j.paused && <Countdown remaining={j.remaining} elapsed={j.elapsed} className="block text-[11px] sm:hidden" />}
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

'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Live progress bars for work running in the background (strategy generation, blog writing),
// shown under the dashboard header on every tab. Polls /api/progress every 4 seconds.
export function JobProgress({ onOpen }: { onOpen?: (kind: string) => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [paused, setPaused] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const j = await fetch('/api/progress').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!stop && j) {
        setJobs(j.jobs || []);
        setPaused(j.aiPaused ? j.aiPausedReason || 'AI credits are low.' : null);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!jobs.length && !paused) return null;
  return (
    <div className="space-y-1.5 border-b bg-muted/30 px-3 py-2 sm:px-4">
      {paused && (
        <button type="button" onClick={() => onOpen?.('settings')} className="block w-full rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-left text-xs">
          <strong>AI work is paused:</strong> {paused} Open Settings &gt; AI credits to add the new balance.
        </button>
      )}
      {jobs.map((j) => (
        <button key={`${j.kind}-${j.id}`} type="button" onClick={() => onOpen?.(j.kind)} className="block w-full text-left">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className={`size-3.5 shrink-0 ${j.paused ? "" : "animate-spin"}`} />
            <span className="truncate font-medium">{j.label}</span>
            <span className="truncate text-muted-foreground">{j.stage}</span>
            <span className="ml-auto tabular-nums">{j.percent}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.max(2, j.percent)}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}

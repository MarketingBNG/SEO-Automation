'use client';

// A live countdown for running work: "about 12 min 30 s left", ticking every second between server
// updates. When the estimate runs out it says the job is taking longer than usual instead of
// showing a negative time.
import { useEffect, useState } from 'react';

export function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${String(r).padStart(2, '0')} s`;
  return `${r} s`;
}

type CountdownProps = {
  remaining: number | null | undefined;
  elapsed?: number | null;
  overdue?: boolean;
  typical?: number | null;
  stageElapsed?: number | null;
  stageTypical?: number | null;
  stageLabel?: string | null;
  ifRepair?: number | null;
  className?: string;
};

export function Countdown({ remaining, elapsed, overdue, typical, stageElapsed, stageTypical, stageLabel, ifRepair, className }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const [base, setBase] = useState(() => ({ at: Date.now(), remaining: remaining ?? null, elapsed: elapsed ?? null, stageElapsed: stageElapsed ?? null }));
  useEffect(() => {
    const at = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBase({ at, remaining: remaining ?? null, elapsed: elapsed ?? null, stageElapsed: stageElapsed ?? null });
    setNow(at);
  }, [remaining, elapsed, stageElapsed]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (base.remaining === null) return null;
  const passed = Math.max(0, (now - base.at) / 1000);
  const left = base.remaining - passed;
  const spent = base.elapsed !== null ? base.elapsed + passed : null;
  const title = [spent !== null ? `Running for ${fmtDuration(spent)}` : '', ifRepair ? `If the checks find a problem, a repair round adds about ${fmtDuration(ifRepair)}.` : ''].filter(Boolean).join(' ');
  // Late: say so (for the step when steps are known, else for the whole job) instead of a number.
  const lateFor = base.stageElapsed !== null && stageTypical ? { on: base.stageElapsed + passed, usual: stageTypical, what: stageLabel ? stageLabel.toLowerCase() : 'this step' } : spent !== null && typical ? { on: spent, usual: typical, what: 'this job' } : null;
  if (overdue && lateFor) {
    return (
      <span className={className} title={title}>
        <span className="text-amber-700 dark:text-amber-400">Taking longer than usual: {fmtDuration(lateFor.on)} on {lateFor.what} (usually about {fmtDuration(lateFor.usual)})</span>
        {spent !== null && lateFor.what !== 'this job' && <span className="text-muted-foreground"> · {fmtDuration(spent)} so far</span>}
      </span>
    );
  }
  return (
    <span className={className} title={title}>
      {left > 1 ? `about ${fmtDuration(left)} left` : 'almost done, taking a little longer than usual'}
      {spent !== null && <span className="text-muted-foreground"> · {fmtDuration(spent)} so far</span>}
    </span>
  );
}

// For a short job started from a button (no server progress): counts down from a typical duration.
export function StartedCountdown({ seconds, className }: { seconds: number; className?: string }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const spent = (now - start) / 1000;
  const left = seconds - spent;
  return (
    <span className={className}>
      {left > 1 ? `about ${fmtDuration(left)} left` : 'almost done, taking a little longer than usual'}
      <span className="text-muted-foreground"> · {fmtDuration(spent)} so far</span>
    </span>
  );
}

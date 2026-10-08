'use client';

// Green / amber / red light in the header: is the automation running. Click for the details
// (what is wrong, and what it does next). Checks every minute while the browser tab is visible.
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const DOT: Record<string, string> = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' };

export function StatusLight() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const j = await fetch('/api/status').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!stop) setS(j || { level: 'red', label: 'Status unavailable', problems: ['The dashboard could not read the automation status.'], notes: [] });
    };
    load();
    const t = setInterval(load, 60000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const level = s?.level || 'checking';
  return (
    <Popover>
      <PopoverTrigger className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs" aria-label={s?.label || 'Checking automation status'}>
        <span className="relative flex size-2.5">
          {level === 'green' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex size-2.5 rounded-full ${DOT[level] || 'bg-muted-foreground'}`} />
        </span>
        <span className="hidden lg:inline">{s?.label || 'Checking…'}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="font-semibold">{s?.label || 'Checking…'}</div>
        {s?.problems?.length > 0 && (
          <ul className="ml-4 list-disc space-y-1 text-xs text-red-700 dark:text-red-400">
            {s.problems.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
        {s?.notes?.length > 0 && (
          <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
            {s.notes.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
        {s?.heartbeat && <div className="text-[11px] text-muted-foreground">Last check: {new Date(s.heartbeat).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST. It checks every 15 minutes.</div>}
      </PopoverContent>
    </Popover>
  );
}

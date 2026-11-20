'use client';

// The one-time monitoring-terms screen. Shown over the whole dashboard until the person ticks the box
// and accepts; their acceptance is recorded (lib/consent.ts). The admin never sees it.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ConsentGate() {
  const [info, setInfo] = useState<any>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/api/consent')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => on && setInfo(j))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  if (!info?.needed) return null;
  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: true }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save your acceptance.');
      setInfo({ needed: false });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">{info.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Please read and accept to continue. This is recorded with your name and the date.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {(info.points || []).map((p: string, i: number) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I have read the above and I agree.
        </label>
        {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
        <Button className="mt-4 w-full" disabled={!agree || busy} onClick={accept}>
          {busy ? 'Saving…' : 'Agree and continue'}
        </Button>
      </div>
    </div>
  );
}

'use client';

// The publish checklist (lib/publishChecklist.ts): Author, Title, Blog text and Banner, each shown
// next to its tick. Publish and Approve stay off until all four are ticked. A tick is kept by the
// server with what it checked, so a change to the title, author, text or banner undoes it.
import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const ALL_TICKED = { author: true, title: true, content: true, banner: true };
type State = { items: { key: string; label: string; ticked: boolean; reset: boolean; by: string | null; at: string | null }[]; complete: boolean; values: { author: string | null; live?: boolean; title: string; words: number; banner: string; bannerReady?: boolean } };

// version: anything that changes when the draft is saved (updated_at, text hash), so the ticks are read again.
export function PublishChecklist({ draftId, version, onReady }: { draftId: number; version?: string; onReady?: (ready: boolean) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/drafts/${draftId}/checklist`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (j) setState(j);
  }, [draftId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, version]);
  useEffect(() => {
    onReady?.(Boolean(state?.complete));
  }, [state?.complete, onReady]);
  async function tick(key: string, value: boolean) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/checklist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setState(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  if (!state) return <div className="text-xs text-muted-foreground">Loading the publish checklist…</div>;
  const v = state.values;
  const shown: Record<string, React.ReactNode> = {
    author: v.author || (v.live ? "the website's default author (this live post has none set)" : <span className="text-amber-700 dark:text-amber-400">no author chosen yet (pick one above)</span>),
    title: v.title || <span className="text-amber-700">no title</span>,
    content: `${v.words} words (read the preview above)`,
    banner: v.bannerReady ? (
      <span className="inline-flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/drafts/${draftId}/cover?v=${encodeURIComponent(`${version || ''}|${v.banner}`)}`} alt="Banner" className="h-16 w-32 rounded border object-cover" />
        {v.banner}
      </span>
    ) : (
      <span className="text-amber-700 dark:text-amber-400">{v.banner}: upload a cover under Cover</span>
    ),
  };
  return (
    <div className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="publish-checklist">
      <div className="flex items-center gap-1.5 font-semibold">
        <ClipboardCheck className="size-4" /> Before it goes live, check each one
      </div>
      {state.items.map((i) => (
        <label key={i.key} className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={i.ticked} disabled={!!busy || (i.key === 'author' && !v.author && !v.live) || (i.key === 'banner' && !v.bannerReady)} onChange={(e) => tick(i.key, e.target.checked)} />
          <span className="min-w-0">
            <span className="font-medium">{i.label}: </span>
            {shown[i.key]}
            {i.ticked && i.by && <span className="block text-xs text-muted-foreground">Ticked by {i.by}{i.at ? `, ${i.at} UTC` : ''}</span>}
            {i.reset && <span className="block text-xs text-amber-700 dark:text-amber-400">Changed since it was ticked: check it again.</span>}
          </span>
          {busy === i.key && <Loader2 className="size-3.5 animate-spin" />}
        </label>
      ))}
      {err && <div className="text-xs text-destructive">{err}</div>}
      {!state.complete && <div className="text-xs text-muted-foreground">Publish and Approve open once all four are ticked.</div>}
    </div>
  );
}

// A button (Approve, Publish now) that first shows the checklist in a pop-up; the action runs from
// there once all four are ticked. The ticks are the ones the pop-up saved (each with what it checked);
// none are sent with the action, so a change made by someone else meanwhile is not ticked silently.
export function ChecklistButton({ draftId, label, children, onConfirm, disabled, className, size = 'sm', variant }: { draftId: number | null | undefined; label: string; children: React.ReactNode; onConfirm: () => void; disabled?: boolean; className?: string; size?: 'sm' | 'default'; variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  if (!draftId) return null;
  return (
    <>
      <Button size={size} variant={variant} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}: check it first</DialogTitle>
            <DialogDescription>Tick each item after checking what is shown next to it.</DialogDescription>
          </DialogHeader>
          {open && <PublishChecklist draftId={draftId} onReady={setReady} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!ready}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {label}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

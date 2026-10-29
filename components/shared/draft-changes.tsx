'use client';

// What changed in a draft's words (edits, Word uploads, optimisations, restores), with Optimise for
// SEO, AEO and GEO and Restore. Used in the draft editor.
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, History, Loader2, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const KIND: Record<string, string> = { edit: 'Edited', upload: 'Word file uploaded', reupload: 'Re-uploaded', optimise: 'Optimised for SEO, AEO and GEO', rewrite: 'Rewritten', restore: 'Earlier version restored' };
const fmt = (s: string) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');

export default function DraftChanges({ draftId, stamp, canEdit, dirty, published, onChanged }: { draftId: number; stamp: string; canEdit: boolean; dirty: boolean; published: boolean; onChanged: () => void }) {
  const [changes, setChanges] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch(`/api/changes?entity=draft&id=${draftId}`).then((x) => (x.ok ? x.json() : { changes: [] })).catch(() => ({ changes: [] })),
      fetch(`/api/drafts/${draftId}/optimise`).then((x) => (x.ok ? x.json() : { running: false })).catch(() => ({ running: false })),
    ]);
    setChanges(c.changes || []);
    setRunning(Boolean(r.running));
  }, [draftId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, stamp]);
  // While an optimisation runs, look every 10 seconds; it usually takes 3 to 6 minutes.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/drafts/${draftId}/optimise`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r && !r.running) {
        setRunning(false);
        setMsg('Optimisation finished. The blog below is the optimised version; the version before it can be restored.');
        onChanged();
      }
    }, 10000);
    return () => clearInterval(t);
  }, [running, draftId, onChanged]);

  async function optimise() {
    if (!window.confirm('Optimise this blog for SEO, AEO and GEO?\n\nYour sentences and facts are kept; the dashboard adds what search and AI answers need (keyword in the title and opening, question headings with direct answers, FAQ, links to the service page, one call to action, meta description). It takes 3 to 6 minutes and about $2 to $4 of AI credit. The version before it stays available under Restore.')) return;
    setBusy('optimise');
    setMsg(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/optimise`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setRunning(true);
      setMsg('Optimising on the server (3 to 6 minutes). You can leave this page; the blog updates when it is done.');
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }
  async function restore(changeId: number) {
    if (!window.confirm('Put back the version from before this change? The current words are kept in the history too.')) return;
    setBusy(`restore-${changeId}`);
    setMsg(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg('The earlier version is back.');
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <History className="size-4" /> Changes to this blog
          {changes && <span className="text-xs font-normal text-muted-foreground">({changes.length})</span>}
        </div>
        {canEdit && !published && (
          <Button size="sm" variant="outline" disabled={running || Boolean(busy) || dirty} title={dirty ? 'Save your changes first.' : 'Keep the text and facts; add what SEO, AEO and GEO need'} onClick={optimise}>
            {running || busy === 'optimise' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {running ? 'Optimising…' : 'Optimise for SEO, AEO and GEO'}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Every edit, Word upload, optimisation and restore is recorded with what changed and how much. The writer learns from the team&apos;s edits every day.</p>
      {msg && <p className={`mt-2 text-xs ${msg.startsWith('Error') ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>{msg}</p>}
      {changes === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : changes.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No change recorded yet. Changes are recorded from now on.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {changes.map((c) => (
            <li key={c.id} className="py-2">
              <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span>
                  <span className="font-medium">{KIND[c.kind] || c.kind}</span>
                  <span className="text-muted-foreground"> by {c.actor || 'someone'}, {fmt(c.created_at)}, {c.changed_pct}% of the text</span>
                  <span className="block text-xs text-muted-foreground">{c.summary}</span>
                </span>
                <ChevronDown className={`mt-1 size-4 shrink-0 transition ${open === c.id ? 'rotate-180' : ''}`} />
              </button>
              {open === c.id && (
                <div className="mt-2 space-y-2 text-xs">
                  {(c.report?.samples || []).length > 0 && (
                    <ul className="space-y-1">
                      {c.report.samples.map((s: any, i: number) => (
                        <li key={i} className="rounded border bg-background p-2">
                          <span className="font-medium">{s.type === 'reworded' ? 'Reworded' : s.type === 'added' ? 'Added' : 'Removed'}{s.heading ? ' heading' : ''}{s.numbers ? ' (number changed)' : ''}: </span>
                          {s.before && <span className="text-muted-foreground line-through">{s.before}</span>} {s.before && s.after && ' '}
                          {s.after && <span>{s.after}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.report?.termsIn?.length > 0 && <div>Words used more: {c.report.termsIn.join(', ')}</div>}
                  {c.report?.termsOut?.length > 0 && <div>Words used less: {c.report.termsOut.join(', ')}</div>}
                  {c.restorable && canEdit && !published && (
                    <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => restore(c.id)}>
                      {busy === `restore-${c.id}` ? <Loader2 className="animate-spin" /> : <Undo2 />} Restore the version before this
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

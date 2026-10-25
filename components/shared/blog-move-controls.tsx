'use client';

// Pause, Resume, Reschedule and Already done for one calendar blog, with suggested new times. Used on Home and
// in Monthly Strategy.
import { useState } from 'react';
import { CalendarClock, CheckCheck, Loader2, Pause, Play, Send } from 'lucide-react';
import { useRole } from '@/hooks/use-role';
import { Button } from '@/components/ui/button';

export default function BlogMoveControls({ row, onDone }: { row: any; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ suggestions: any[]; custom: string } | null>(null);
  const me = useRole();
  if (['published', 'failed', 'drafting', 'revising'].includes(row.status)) return null;

  async function act(body: any, done: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/strategy/schedule/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.needsReschedule) setOpen({ suggestions: j.suggestions || [], custom: '' });
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(null);
      onDone(j.note ? `${done} ${j.note}` : done);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleMove() {
    if (open) return setOpen(null);
    setBusy(true);
    const j = await fetch(`/api/strategy/schedule/${row.id}`).then((r) => r.json()).catch(() => ({}));
    setBusy(false);
    setOpen({ suggestions: j.suggestions || [], custom: '' });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {row.status === 'paused' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: 'resume' }, `Resumed "${row.title}".`)}>
            <Play /> Resume
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: 'pause' }, `Paused "${row.title}". Nothing happens to it until you resume or reschedule it.`)}>
            <Pause /> Pause
          </Button>
        )}
        {me.can('blog.publish_now') && row.draft_id && (
          <Button
            size="sm"
            disabled={busy}
            title="Publish it on the website now, instead of at its slot. It must be approved first."
            onClick={() => window.confirm(`Publish "${row.title}" on the website now?`) && act({ action: 'publish_now' }, `Published "${row.title}" on the website.`)}
          >
            <Send /> Publish now
          </Button>
        )}
        {me.can('blog.publish_now') && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title="It was already published outside the dashboard: mark it done so nothing tries it again."
            onClick={() => {
              const url = window.prompt(`Mark "${row.title}" as already done? Nothing will try to write or publish it again.\n\nLive post address (optional):`, '');
              if (url !== null) act({ action: 'mark_done', url }, `Marked "${row.title}" as done.`);
            }}
          >
            <CheckCheck /> Already done
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={toggleMove}>
          {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />} Reschedule
        </Button>
      </div>
      {open && (
        <div className="max-w-sm space-y-1 rounded-lg border p-2 text-xs">
          <div className="font-medium">Suggested times</div>
          {open.suggestions.length === 0 && <div className="text-muted-foreground">No free day in the next three weeks. Pick a time below.</div>}
          {open.suggestions.map((sg: any) => (
            <button key={sg.at} className="block w-full rounded border p-1.5 text-left hover:bg-muted" disabled={busy} onClick={() => act({ action: 'reschedule', publishAt: sg.at }, `Moved "${row.title}" to ${sg.label}.`)}>
              <div className="font-medium">{sg.label}</div>
              <div className="text-muted-foreground">{sg.why}</div>
            </button>
          ))}
          <div className="pt-1 font-medium">Or pick a time (IST)</div>
          <input type="datetime-local" className="w-full rounded border bg-background p-1" value={open.custom} onChange={(e) => setOpen({ ...open, custom: e.target.value })} />
          <Button size="sm" disabled={!open.custom || busy} onClick={() => act({ action: 'reschedule', publishAt: `${open.custom}:00+05:30` }, `Moved "${row.title}".`)}>
            Save the new time
          </Button>
        </div>
      )}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
    </div>
  );
}

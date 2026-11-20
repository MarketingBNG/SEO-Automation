'use client';

// Tasks a person has to do for the approved strategy (directory profiles, developer fixes), each with
// a step-by-step guide for someone doing it for the first time: link, sign-in, what to fill in, and
// ready-to-paste text. Shown as a banner + pop-up at the top of the strategy page and as a section.
// A task marked done stays on the page (Done list) with when and who, the listing address and the
// notes typed in, so the work can be checked again; "Mark not done" puts back a mistaken tick.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Copy, ExternalLink, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRole } from '@/hooks/use-role';
import { StartedCountdown } from './countdown';

type Guide = {
  summary?: string;
  link?: string;
  timeMinutes?: number;
  prepare?: string[];
  steps?: { title: string; detail: string; link?: string }[];
  copy?: { field: string; value: string }[];
  check?: string;
  ifStuck?: string;
};
type Task = {
  kind: 'backlink' | 'fix';
  id: number;
  title: string;
  detail: string;
  date: string | null;
  done: boolean;
  guide: Guide | null;
  assignedTo: string | null;
  doneAt?: string | null;
  doneBy?: string | null;
  listingUrl?: string | null;
  notes?: string | null;
  link?: string | null;
};
type Action = 'guide' | 'done' | 'undo' | 'assign' | 'details';
type Details = { listingUrl?: string; notes?: string };

export function useManualTasks(strategyId: number, enabled: boolean) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [team, setTeam] = useState<{ email: string; name: string | null; role: string }[]>([]);
  const canAssign = useRole().can('manual.assign');
  const load = useCallback(async () => {
    if (!enabled) return;
    const res = await fetch(`/api/strategy/${strategyId}/manual`).catch(() => null);
    const json = res && res.ok ? await res.json() : { tasks: [] };
    setTasks(json.tasks || []);
    setLoaded(true);
    // The people to assign come with the tasks: a tester may assign without seeing the team page.
    if (canAssign && Array.isArray(json.team)) setTeam(json.team);
  }, [strategyId, enabled, canAssign]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  const act = async (t: Task, action: Action, regenerate = false, email?: string | null, details?: Details) => {
    const res = await fetch('/api/strategy/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: t.kind, id: t.id, action, regenerate, email, ...(details || {}) }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (action === 'guide') setTasks((ts) => ts.map((x) => (x.kind === t.kind && x.id === t.id ? { ...x, guide: json.guide } : x)));
    else if (action === 'assign') setTasks((ts) => ts.map((x) => (x.kind === t.kind && x.id === t.id ? { ...x, assignedTo: email || null } : x)));
    // Done, not done and details: read back, so the page shows what was saved (who, when, address).
    else await load();
  };
  return { tasks, loaded, pending: tasks.filter((t) => !t.done), reload: load, act, team, canAssign };
}

type M = ReturnType<typeof useManualTasks>;

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      <Copy className="size-3.5" />
      {ok ? 'Copied' : 'Copy'}
    </Button>
  );
}

function GuideView({ g }: { g: Guide }) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
      {g.summary && <p>{g.summary}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {g.link && (
          <a href={g.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-primary hover:underline">
            Start here <ExternalLink className="size-3.5" />
          </a>
        )}
        {g.timeMinutes ? <span className="text-xs text-muted-foreground">About {g.timeMinutes} minutes</span> : null}
      </div>
      {g.prepare?.length ? (
        <div>
          <div className="font-semibold">Before you start, have ready</div>
          <ul className="ml-5 list-disc">{g.prepare.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {g.steps?.length ? (
        <div>
          <div className="font-semibold">Steps</div>
          <ol className="ml-5 list-decimal space-y-1">
            {g.steps.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.title}.</span> {s.detail}
                {s.link && (
                  <a href={s.link} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                    open <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {g.copy?.length ? (
        <div>
          <div className="font-semibold">Copy and paste into the form</div>
          <p className="text-xs text-muted-foreground">Replace anything in [Fill in: ...] before saving. It is there because the fact was not on our website.</p>
          <div className="mt-1 space-y-2">
            {g.copy.map((c) => (
              <div key={c.field} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{c.field}</span>
                  <CopyButton text={c.value} />
                </div>
                <div className="mt-1 whitespace-pre-wrap">{c.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {g.check && (
        <p>
          <span className="font-semibold">How to check it worked: </span>
          {g.check}
        </p>
      )}
      {g.ifStuck && (
        <p>
          <span className="font-semibold">If you get stuck: </span>
          {g.ifStuck}
        </p>
      )}
    </div>
  );
}

const fmtWhen = (s?: string | null) =>
  s ? new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '';

// The listing's address and notes: typed when marking a task done, and changeable afterwards.
function DetailsForm({ t, busy, submitLabel, onSubmit, onCancel }: { t: Task; busy: boolean; submitLabel: string; onSubmit: (d: Details) => void; onCancel: () => void }) {
  const [listingUrl, setListingUrl] = useState(t.listingUrl || '');
  const [notes, setNotes] = useState(t.notes || '');
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
      <label className="block">
        <span className="font-medium">{t.kind === 'fix' ? 'Page to check it on' : 'Listing or profile address'}</span>
        <Input className="mt-1 h-8" placeholder="https://..." value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} />
      </label>
      <label className="block">
        <span className="font-medium">Notes (login email or username, what was filled in). Never a password.</span>
        <textarea className="mt-1 w-full rounded-md border bg-background p-2" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onSubmit({ listingUrl, notes })}>
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function TaskRow({ t, m }: { t: Task; m: M }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<null | 'done' | 'details'>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (action: Action, regenerate = false, email?: string | null, details?: Details) => {
    setBusy(action);
    setErr(null);
    try {
      await m.act(t, action, regenerate, email, details);
      if (action === 'guide') setOpen(true);
      if (action === 'done' || action === 'details') setForm(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className={`space-y-2 rounded-lg border p-3 ${t.done ? 'border-emerald-500/30 bg-emerald-500/5' : ''}`}>
      <div className="flex items-start gap-2">
        {t.done ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
        ) : (
          <input type="checkbox" className="mt-1" checked={false} disabled={!!busy} onChange={() => setForm('done')} title="Tick when it is done" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {!t.done && t.date && t.date.slice(0, 10) < todayIst() && <span className="mr-2 rounded bg-red-500/15 px-1.5 py-px text-xs font-semibold text-red-700 dark:text-red-400">Due</span>}
            {t.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {t.kind === 'fix' ? 'Website fix for a developer' : 'Profile or listing to create'}
            {t.date ? `, planned ${t.date.slice(0, 10)}` : ''}. {t.detail}
          </div>
          {t.done && (
            <div className="mt-1 space-y-0.5 text-xs">
              <div className="font-medium text-emerald-700 dark:text-emerald-400">
                Done{t.doneAt ? ` on ${fmtWhen(t.doneAt)}` : ''}{t.doneBy ? ` by ${t.doneBy}` : ''}
              </div>
              {t.listingUrl ? (
                <a href={t.listingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open the {t.kind === 'fix' ? 'page' : 'listing'}: {t.listingUrl} <ExternalLink className="size-3" />
                </a>
              ) : (
                <div className="text-amber-700 dark:text-amber-400">No listing address saved yet. Add it under Edit details so it can be checked.</div>
              )}
              {t.notes && <div className="whitespace-pre-wrap text-muted-foreground">Notes: {t.notes}</div>}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {t.link && (
              <a href={t.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                {t.kind === 'fix' ? 'Open the page' : 'Sign-up page'} <ExternalLink className="size-3" />
              </a>
            )}
            {m.canAssign ? (
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Assigned to</span>
                <select
                  className="h-7 rounded-md border bg-background px-1"
                  value={t.assignedTo || ''}
                  onChange={(e) => run('assign', false, e.target.value || null)}
                >
                  <option value="">Nobody yet</option>
                  {m.team.map((p) => (
                    <option key={p.email} value={p.email}>{p.name || p.email} ({p.role})</option>
                  ))}
                </select>
              </label>
            ) : t.assignedTo ? (
              <span className="text-muted-foreground">Assigned to {t.assignedTo}</span>
            ) : null}
            {t.done && (
              <>
                <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => setForm(form === 'details' ? null : 'details')}>Edit details</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  disabled={!!busy}
                  onClick={() => window.confirm(`Mark "${t.title}" as not done? It goes back on the to-do list; the address and notes are kept.`) && run('undo')}
                >
                  {busy === 'undo' ? <Loader2 className="animate-spin" /> : <RotateCcw className="size-3.5" />}Mark not done
                </Button>
              </>
            )}
          </div>
        </div>
        {t.guide ? (
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide guide' : 'Show guide'}</Button>
        ) : !t.done ? (
          <Button size="sm" disabled={!!busy} onClick={() => run('guide')}>
            {busy === 'guide' && <Loader2 className="animate-spin" />}How to do it
          </Button>
        ) : null}
      </div>
      {form === 'done' && <DetailsForm t={t} busy={busy === 'done'} submitLabel="Mark done" onSubmit={(d) => run('done', false, undefined, d)} onCancel={() => setForm(null)} />}
      {form === 'details' && <DetailsForm t={t} busy={busy === 'details'} submitLabel="Save details" onSubmit={(d) => run('details', false, undefined, d)} onCancel={() => setForm(null)} />}
      {busy === 'guide' && (
        <p className="text-xs text-muted-foreground">
          Writing the guide (checks the official site and our website): <StartedCountdown seconds={75} />
        </p>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
      {open && t.guide && (
        <>
          <GuideView g={t.guide} />
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run('guide', true)}>
            {busy === 'guide' ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-3.5" />}Write the guide again
          </Button>
        </>
      )}
    </li>
  );
}

const DONE_PAGE = 50;

// To do first; the done tasks (from every month) below, newest first, kept for good.
export function ManualTaskList({ m }: { m: M }) {
  const [showDone, setShowDone] = useState(false);
  const [doneShown, setDoneShown] = useState(DONE_PAGE);
  if (!m.loaded) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!m.tasks.length) return <p className="text-sm text-muted-foreground">Nothing needs a person right now. Everything in this strategy runs automatically.</p>;
  const done = m.tasks.filter((t) => t.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')) || b.id - a.id);
  return (
    <div className="space-y-3">
      {m.pending.length ? (
        <ul className="space-y-2">
          {sortDue(m.pending).map((t) => (
            <TaskRow key={`${t.kind}-${t.id}`} t={t} m={m} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing left to do. The done tasks are below.</p>
      )}
      {done.length > 0 && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" onClick={() => setShowDone((v) => !v)}>
            <CheckCircle2 className="size-3.5" />
            {showDone ? 'Hide done' : `Show done (${done.length})`}
          </Button>
          {showDone && (
            <>
              <p className="text-xs text-muted-foreground">Every task marked done, from every month, with who did it, when, and the listing address, so it can be checked again. They are never removed.</p>
              <ul className="space-y-2">
                {done.slice(0, doneShown).map((t) => (
                  <TaskRow key={`${t.kind}-${t.id}`} t={t} m={m} />
                ))}
              </ul>
              {done.length > doneShown && (
                <Button size="sm" variant="ghost" onClick={() => setDoneShown((n) => n + DONE_PAGE)}>Show {Math.min(DONE_PAGE, done.length - doneShown)} more</Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Banner at the top of the strategy page; opens the checklist in a pop-up (once per session on its own).
export function ManualTasksBanner({ m, strategyId }: { m: M; strategyId: number }) {
  const [open, setOpen] = useState(false);
  const count = m.pending.length;
  useEffect(() => {
    if (!m.loaded || !count) return;
    const key = `manual-tasks-shown-${strategyId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
  }, [m.loaded, count, strategyId]);
  if (!m.loaded || !count) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <ClipboardCheck className="size-4" />
          {count} task{count === 1 ? '' : 's'} in this strategy need a person. Everything else runs automatically.
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>Open checklist</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tasks for your team</DialogTitle>
            <DialogDescription>
              These cannot be done automatically (sign-ups, verification, captchas, or developer work). Click &quot;How to do it&quot; for a step-by-step guide with links and text to copy. Tick each one when done and add the listing address, so it can be checked later under &quot;Show done&quot;.
            </DialogDescription>
          </DialogHeader>
          <ManualTaskList m={m} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// Today in India (YYYY-MM-DD). A task not done from an earlier day shows "Due" and comes first.
function todayIst() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
function sortDue(tasks: any[]) {
  const today = todayIst();
  const due = (t: any) => !t.done && t.date && t.date.slice(0, 10) < today;
  return [...tasks].sort((a, b) => Number(due(b)) - Number(due(a)) || Number(a.done) - Number(b.done));
}

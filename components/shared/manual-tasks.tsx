'use client';

// Tasks a person has to do for the approved strategy (directory profiles, developer fixes), each with
// a step-by-step guide for someone doing it for the first time: link, sign-in, what to fill in, and
// ready-to-paste text. Shown as a banner + pop-up at the top of the strategy page and as a section.
import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
type Task = { kind: 'backlink' | 'fix'; id: number; title: string; detail: string; date: string | null; done: boolean; guide: Guide | null; assignedTo: string | null };

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
    if (canAssign) {
      const t = await fetch('/api/team').catch(() => null);
      if (t?.ok) setTeam(await t.json());
    }
  }, [strategyId, enabled, canAssign]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  const act = async (t: Task, action: 'guide' | 'done' | 'undo' | 'assign', regenerate = false, email?: string | null) => {
    const res = await fetch('/api/strategy/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: t.kind, id: t.id, action, regenerate, email }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (action === 'guide') setTasks((ts) => ts.map((x) => (x.kind === t.kind && x.id === t.id ? { ...x, guide: json.guide } : x)));
    else if (action === 'assign') setTasks((ts) => ts.map((x) => (x.kind === t.kind && x.id === t.id ? { ...x, assignedTo: email || null } : x)));
    else setTasks((ts) => ts.map((x) => (x.kind === t.kind && x.id === t.id ? { ...x, done: action === 'done' } : x)));
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

function TaskRow({ t, m }: { t: Task; m: M }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (action: 'guide' | 'done' | 'undo' | 'assign', regenerate = false, email?: string | null) => {
    setBusy(action);
    setErr(null);
    try {
      await m.act(t, action, regenerate, email);
      if (action === 'guide') setOpen(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={t.done} disabled={!!busy} onChange={() => run(t.done ? 'undo' : 'done')} title="Tick when it is done" />
        <div className="min-w-0 flex-1">
          <div className={t.done ? 'font-medium text-muted-foreground line-through' : 'font-medium'}>{t.title}</div>
          <div className="text-xs text-muted-foreground">
            {t.kind === 'fix' ? 'Website fix for a developer or WordPress admin' : 'Profile or listing to create'}
            {t.date ? `, planned ${t.date.slice(0, 10)}` : ''}. {t.detail}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
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
          </div>
        </div>
        {t.guide ? (
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide guide' : 'Show guide'}</Button>
        ) : (
          <Button size="sm" disabled={!!busy} onClick={() => run('guide')}>
            {busy === 'guide' && <Loader2 className="animate-spin" />}How to do it
          </Button>
        )}
      </div>
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

export function ManualTaskList({ m }: { m: M }) {
  if (!m.loaded) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!m.tasks.length) return <p className="text-sm text-muted-foreground">Nothing needs a person right now. Everything in this strategy runs automatically.</p>;
  return (
    <ul className="space-y-2">
      {m.tasks.map((t) => (
        <TaskRow key={`${t.kind}-${t.id}`} t={t} m={m} />
      ))}
    </ul>
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
              These cannot be done automatically (sign-ups, verification, captchas, or developer work). Click &quot;How to do it&quot; for a step-by-step guide with links and text to copy. Tick each one when done.
            </DialogDescription>
          </DialogHeader>
          <ManualTaskList m={m} />
        </DialogContent>
      </Dialog>
    </>
  );
}

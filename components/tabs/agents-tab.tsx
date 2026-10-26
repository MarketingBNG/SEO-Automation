'use client';

// Agents & memory: each agent's job and AI, what it has learned (mistakes, lessons, the team's rules,
// incidents, development changes), a box to teach it a rule, and the Ops agent's daily health report.
import { useCallback, useEffect, useState } from 'react';
import { BrainCog, HeartPulse, Loader2, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/shared/status-badge';
import { useRole } from '@/hooks/use-role';

const KIND: Record<string, { label: string; tone: string }> = {
  mistake: { label: 'Mistake', tone: 'failed' },
  preference: { label: 'Team rule', tone: 'gold' },
  lesson: { label: 'Lesson', tone: 'drafted' },
  incident: { label: 'Incident', tone: 'generating' },
  change: { label: 'Change', tone: 'pending' },
  fact: { label: 'Fact', tone: 'approved' },
};
const STATUS_TONE: Record<string, string> = { ok: 'border-emerald-500/40 bg-emerald-500/10', warn: 'border-amber-500/50 bg-amber-500/10', fail: 'border-red-500/40 bg-red-500/10' };

export default function AgentsTab() {
  const who = useRole();
  const canTeach = who.role === 'admin' || who.role === 'manager';
  const [data, setData] = useState<any>(null);
  const [agent, setAgent] = useState<string>('writer');
  const [memories, setMemories] = useState<any[]>([]);
  const [showRetired, setShowRetired] = useState(false);
  const [teach, setTeach] = useState('');
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/agents').then((r) => r.json()).catch(() => null);
    if (j && !j.error) setData(j);
  }, []);
  const loadMemories = useCallback(async (key: string) => {
    const j = await fetch(`/api/agents?agent=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => null);
    setMemories(j?.memories || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMemories(agent); }, [agent, loadMemories]);

  async function post(body: any, done: string) {
    setBusy(body.action + (body.id || ''));
    setMsg(null);
    const res = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(j.error || 'Failed');
    setMsg(done);
    await Promise.all([load(), loadMemories(agent)]);
    return j;
  }

  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading...</CardContent></Card>;
  const current = data.agents.find((a: any) => a.key === agent);
  const shown = memories.filter((m) => (showRetired ? m.status === 'retired' : m.status === 'active'));
  const ops = data.ops;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BrainCog className="size-5" />Agents &amp; memory</CardTitle>
          <CardDescription>
            Each agent does one job and keeps its own memory: the mistakes it made, reviewers&apos; feedback, the weekly lessons, the team&apos;s rules and what changed in development. Before every job it reads its memory, so results get better and an old mistake is not made twice. Phase 1 is live (Writer, Fact-Check, Ops); the others follow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.agents.map((a: any) => {
              const total = Object.values(a.memory || {}).reduce((n: number, v: any) => n + v, 0) as number;
              return (
                <button key={a.key} type="button" onClick={() => setAgent(a.key)} className={`rounded-lg border p-3 text-left text-sm transition hover:bg-muted/50 ${agent === a.key ? 'border-primary ring-1 ring-primary' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{a.name}</span>
                    <StatusBadge status={a.active ? 'approved' : 'pending'}>{a.active ? 'Live' : `Phase ${a.phase}`}</StatusBadge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{a.job}</div>
                  <div className="mt-2 text-xs"><span className="text-muted-foreground">AI:</span> {a.ai}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{total ? Object.entries(a.memory).map(([k, v]) => `${v} ${(KIND[k]?.label || k).toLowerCase()}${Number(v) === 1 ? '' : 's'}`).join(' · ') : 'Nothing remembered yet'}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle>{current.name}: memory</CardTitle>
            <CardDescription>Remembers: {current.remembers}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {canTeach && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="font-medium">Teach {current.name} a rule</div>
                <Textarea rows={2} value={teach} onChange={(e) => setTeach(e.target.value)} placeholder={`For example: "Never quote a rate without the year it applies to."`} />
                <Button size="sm" disabled={!teach.trim() || !!busy} onClick={() => post({ action: 'teach', agent, text: teach }, 'Taught. It applies from the next job.').then((j) => j && setTeach(''))}>{busy === 'teach' ? <Loader2 className="animate-spin" /> : <Save />}Save the rule</Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant={showRetired ? 'outline' : 'secondary'} onClick={() => setShowRetired(false)}>Active ({memories.filter((m) => m.status === 'active').length})</Button>
              <Button size="sm" variant={showRetired ? 'secondary' : 'outline'} onClick={() => setShowRetired(true)}>Retired ({memories.filter((m) => m.status === 'retired').length})</Button>
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
            {shown.length === 0 && <div className="text-muted-foreground">Nothing here yet. Memories appear as the agent works (rejections, fact-check corrections, weekly lessons, incidents) and when you teach it.</div>}
            <ul className="divide-y rounded-lg border">
              {shown.map((m) => (
                <li key={m.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status={KIND[m.kind]?.tone || 'pending'}>{KIND[m.kind]?.label || m.kind}</StatusBadge>
                    {m.strength > 1 && <span className="text-muted-foreground">seen {m.strength}x</span>}
                    <span className="text-muted-foreground">from {m.source}{m.source_ref ? ` (${m.source_ref})` : ''} · {m.last_seen_at} UTC{m.created_by ? ` · ${m.created_by}` : ''}{m.uses ? ` · used ${m.uses}x` : ''}</span>
                    {m.kind === 'incident' && m.resolved_at && <StatusBadge status="approved">resolved {m.resolved_at}</StatusBadge>}
                    {canTeach && (
                      <span className="ml-auto flex gap-1">
                        {m.status === 'active' ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ id: m.id, text: m.body })}><Pencil /></Button>
                            <Button size="sm" variant="ghost" disabled={!!busy} title="Retire: the agent stops using it" onClick={() => post({ action: 'retire', id: m.id }, 'Retired.')}><Trash2 /></Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post({ action: 'restore', id: m.id }, 'Restored.')}><RotateCcw />Restore</Button>
                        )}
                      </span>
                    )}
                  </div>
                  {editing && editing.id === m.id ? (
                    <div className="flex gap-2">
                      <Textarea rows={2} value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} />
                      <div className="flex flex-col gap-1">
                        <Button size="sm" disabled={!!busy} onClick={() => post({ action: 'edit', id: m.id, text: editing.text }, 'Saved.').then(() => setEditing(null))}><Save /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X /></Button>
                      </div>
                    </div>
                  ) : (
                    <div>{m.body}</div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HeartPulse className="size-4" />Ops health check</CardTitle>
          <CardDescription>
            Runs every day by itself (no AI, exact checks). New problems are sent to Slack and remembered as incidents until they are fixed.
            {ops?.at ? ` Last run ${new Date(ops.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST.` : ' Not run yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => post({ action: 'run_ops' }, 'Health check done.')}>{busy === 'run_ops' ? <Loader2 className="animate-spin" /> : <HeartPulse />}Run the health check now</Button>
          {(ops?.checks || []).map((c: any) => (
            <div key={c.key} className={`rounded-lg border p-2 ${STATUS_TONE[c.status]}`}>
              <div className="font-medium">{c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕'} {c.label}</div>
              <div className="text-xs">{c.detail}</div>
              {c.fix && c.status !== 'ok' && <div className="mt-1 text-xs"><strong>What to do:</strong> {c.fix}</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      {data.changes?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent development changes</CardTitle><CardDescription>From CHANGELOG.md; each agent remembers the changes that affect its work.</CardDescription></CardHeader>
          <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{data.changes.map((c: any, i: number) => <li key={i}><span className="text-xs text-muted-foreground">({c.agent})</span> {c.body}</li>)}</ul></CardContent>
        </Card>
      )}
    </div>
  );
}

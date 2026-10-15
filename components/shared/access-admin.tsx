'use client';

// Team & Roles, admin only: what each role sees and does, and extra access for one person, for good
// or for some hours. The server applies the same rules (proxy.ts, lib/access.ts).
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const fmt = (s: string) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';
const DURATIONS = [
  { label: 'Always', hours: '' },
  { label: '1 hour', hours: '1' },
  { label: '2 hours', hours: '2' },
  { label: '8 hours', hours: '8' },
  { label: '1 day', hours: '24' },
  { label: '2 days', hours: '48' },
  { label: '1 week', hours: '168' },
];

export function AccessAdmin({ people }: { people: { email: string; name: string | null; role: string }[] }) {
  const [d, setD] = useState<any>(null);
  const [role, setRole] = useState('manager');
  const [edit, setEdit] = useState<{ pages: string[]; actions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [g, setG] = useState({ email: '', keys: [] as string[], hours: '', custom: '' });

  const load = useCallback(async () => {
    const j = await fetch('/api/team/access').then((r) => (r.ok ? r.json() : null));
    if (j) setD(j);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useEffect(() => {
    const r = d?.roles.find((x: any) => x.role === role);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (r) setEdit({ pages: [...r.access.pages], actions: [...r.access.actions] });
  }, [d, role]);

  async function post(body: any, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/team/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg(`${done} ${j.note || ''}`.trim());
      await load();
      return true;
    } catch (e: any) {
      setMsg('Error: ' + e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!d || !edit) return null;
  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const current = d.roles.find((x: any) => x.role === role);
  const options = [...d.pages.map((p: any) => ({ key: `page:${p.key}`, label: `Page: ${p.label}` })), ...d.actions.map((a: any) => ({ key: a.key, label: `Action: ${a.label}` }))];
  const labelOf = (k: string) => options.find((o: any) => o.key === k)?.label || k;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Access for each role</CardTitle>
          <CardDescription>Tick what a role can open and do. The admin always has everything. Changes apply within a minute.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {d.roles.filter((r: any) => !r.fixed).map((r: any) => (
              <Button key={r.role} size="sm" variant={role === r.role ? 'default' : 'outline'} className="capitalize" onClick={() => setRole(r.role)}>
                {r.role}
                {r.custom ? ' (changed)' : ''}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold">Pages it can open</div>
              {d.pages.map((p: any) => (
                <label key={p.key} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={edit.pages.includes(p.key)} onChange={() => setEdit({ ...edit, pages: toggle(edit.pages, p.key) })} />
                  {p.label}
                </label>
              ))}
            </div>
            <div>
              <div className="mb-1 font-semibold">What it can do</div>
              {d.actions.map((a: any) => (
                <label key={a.key} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={edit.actions.includes(a.key)} onChange={() => setEdit({ ...edit, actions: toggle(edit.actions, a.key) })} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => post({ op: 'role', role, ...edit }, `Saved access for ${role}.`)}>
              {busy && <Loader2 className="animate-spin" />} Save {role} access
            </Button>
            {current?.custom && (
              <Button variant="outline" disabled={busy} onClick={() => post({ op: 'reset', role }, `${role} is back to the standard access.`)}>
                Reset to standard
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extra access for one person</CardTitle>
          <CardDescription>Give someone a page or an action on top of their role: always, or for a few hours (it ends by itself).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-9 rounded-md border bg-background px-2" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })}>
              <option value="">Pick a person</option>
              {people.filter((p) => p.role !== 'admin').map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name || p.email} ({p.role})
                </option>
              ))}
            </select>
            <select className="h-9 rounded-md border bg-background px-2" value={g.custom ? 'custom' : g.hours} onChange={(e) => setG({ ...g, hours: e.target.value === 'custom' ? '' : e.target.value, custom: e.target.value === 'custom' ? '3' : '' })}>
              {DURATIONS.map((x) => (
                <option key={x.label} value={x.hours}>
                  {x.label}
                </option>
              ))}
              <option value="custom">Other (hours)…</option>
            </select>
            {g.custom !== '' && <Input className="h-9 w-24" type="number" min="0.25" step="0.25" value={g.custom} onChange={(e) => setG({ ...g, custom: e.target.value })} aria-label="Hours" />}
          </div>
          <div className="grid max-h-64 gap-x-4 overflow-auto rounded-md border p-2 md:grid-cols-2">
            {options.map((o: any) => (
              <label key={o.key} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={g.keys.includes(o.key)} onChange={() => setG({ ...g, keys: toggle(g.keys, o.key) })} />
                {o.label}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || !g.email || !g.keys.length}
            onClick={async () => {
              const hours = g.custom !== '' ? g.custom : g.hours;
              if (await post({ op: 'grant', email: g.email, keys: g.keys, hours: hours || null }, 'Access given.')) setG({ email: '', keys: [], hours: '', custom: '' });
            }}
          >
            Give access
          </Button>
          {d.grants.length > 0 && (
            <ul className="space-y-1">
              {d.grants.map((x: any) => (
                <li key={x.id} className={`flex flex-wrap items-center gap-2 ${x.active ? '' : 'text-muted-foreground line-through'}`}>
                  <span className="font-medium">{x.email}</span>
                  <span>{labelOf(x.grant_key)}</span>
                  <span className="text-muted-foreground">{x.expires_at ? `${x.active ? 'until' : 'ended'} ${fmt(x.expires_at)}` : 'always'}</span>
                  <button type="button" className="text-primary underline" disabled={busy} onClick={() => post({ op: 'revoke', id: x.id }, 'Access taken back.')}>
                    {x.active ? 'Take back' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {msg && <div className={`rounded-lg border p-2 text-sm ${msg.startsWith('Error') ? 'border-red-500/40 bg-red-500/10' : ''}`}>{msg}</div>}
    </>
  );
}

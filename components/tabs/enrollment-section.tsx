'use client';

// Training Enrollment (admin and managers): enroll non-admin employees into the training/SEB program,
// pause/activate, change level, unblock, and optionally auto-enroll qualifying people on first login.
// All authority is enforced server-side in /api/training/admin; this page only calls it.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Row = {
  email: string; name: string | null; role: string; team: string | null;
  blocked: boolean; enrolled: boolean; level: number | null; active: boolean | null; enrolledAt: string | null;
};
type Data = { rows: Row[]; autoEnroll: { on: boolean; roles: string[] }; roles: string[]; canSetRoles: boolean; role: string };

const fmtDay = (s: string | null) => (s ? String(s).slice(0, 10) : '—');

export function EnrollmentSection() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [level, setLevel] = useState('1');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/training/admin');
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Could not load enrollment.'); return; }
      setData(j); setErr(null);
    } catch { setErr('Could not reach the server.'); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load, same as other tabs
  useEffect(() => { load(); }, [load]);

  async function post(body: any, tag: string) {
    setBusy(tag); setErr(null);
    try {
      const r = await fetch('/api/training/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || `Action failed (HTTP ${r.status}).`); return false; }
      await load();
      return true;
    } catch { setErr('Could not reach the server.'); return false; }
    finally { setBusy(null); }
  }

  async function enroll() {
    if (!email.trim()) return;
    const ok = await post({ op: 'enroll', email: email.trim(), role, level: Number(level) || 1 }, 'enroll');
    if (ok) { setEmail(''); setRole('user'); setLevel('1'); }
  }

  async function remove(target: string) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${target} completely? This deletes their team membership, training profile and data, device token and SEB/Zoho connection. The audit log is kept. This cannot be undone.`)) return;
    await post({ op: 'remove', email: target }, target);
  }

  if (err && !data) {
    return (
      <section className="grid gap-3">
        <h2 className="text-base font-semibold tracking-tight">Training Enrollment</h2>
        <p className="text-sm text-red-600">{err}</p>
        <div><Button size="sm" onClick={load}>Retry</Button></div>
      </section>
    );
  }
  if (!data) return <section className="grid gap-2"><h2 className="text-base font-semibold tracking-tight">Training Enrollment</h2><p className="text-sm text-muted-foreground">Loading…</p></section>;

  const canRoles = data.canSetRoles; // admin: may add new people and set roles
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Training Enrollment</h2>
        <p className="text-sm text-muted-foreground">Enroll employees into the training and SEB program, set their level, pause or activate, and unblock. The admin is never a trainee. No Coolify needed.</p>
      </div>

      {/* Enroll form */}
      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Employee email (@usaindiacfo.com)</span>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@usaindiacfo.com" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Role</span>
          <select className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50" value={role} onChange={(e) => setRole(e.target.value)} disabled={!canRoles} title={canRoles ? '' : 'Only an admin can set a role; a manager can enroll someone already on the team.'}>
            {data.roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Level</span>
          <Input className="w-20" type="number" min={1} max={5} value={level} onChange={(e) => setLevel(e.target.value)} />
        </label>
        <Button onClick={enroll} disabled={busy === 'enroll' || !email.trim()}>{busy === 'enroll' ? 'Enrolling…' : 'Enroll'}</Button>
      </div>
      {!canRoles && <p className="-mt-2 text-xs text-muted-foreground">As a manager you can enroll people already on the team; adding a new person or changing a role is admin-only.</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Enrolled table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Employee</th><th className="p-2">Role</th><th className="p-2">Level</th>
              <th className="p-2">Status</th><th className="p-2">Enrolled</th><th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.email} className="border-t align-middle">
                <td className="p-2"><div className="font-medium">{r.name || r.email}</div><div className="text-xs text-muted-foreground">{r.email}{r.team ? ` · ${r.team}` : ''}</div></td>
                <td className="p-2">{r.role}</td>
                <td className="p-2">
                  {r.enrolled ? (
                    <div className="flex items-center gap-1">
                      <span>{r.level}</span>
                      <Button size="icon" variant="ghost" className="size-6" disabled={busy === r.email || (r.level ?? 1) <= 1} onClick={() => post({ op: 'level', email: r.email, level: (r.level ?? 1) - 1 }, r.email)} aria-label="Lower level">−</Button>
                      <Button size="icon" variant="ghost" className="size-6" disabled={busy === r.email || (r.level ?? 1) >= 5} onClick={() => post({ op: 'level', email: r.email, level: (r.level ?? 1) + 1 }, r.email)} aria-label="Raise level">+</Button>
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {!r.enrolled && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">not enrolled</span>}
                    {r.enrolled && <span className={`rounded px-1.5 py-0.5 text-xs ${r.active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>{r.active ? 'active' : 'paused'}</span>}
                    {r.blocked && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-600">blocked</span>}
                  </div>
                </td>
                <td className="p-2 text-xs text-muted-foreground">{fmtDay(r.enrolledAt)}</td>
                <td className="p-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {!r.enrolled && <Button size="sm" variant="outline" disabled={busy === r.email} onClick={() => post({ op: 'enroll', email: r.email, level: 1 }, r.email)}>Enroll</Button>}
                    {r.enrolled && r.active && <Button size="sm" variant="outline" disabled={busy === r.email} onClick={() => post({ op: 'pause', email: r.email }, r.email)}>Pause</Button>}
                    {r.enrolled && !r.active && <Button size="sm" variant="outline" disabled={busy === r.email} onClick={() => post({ op: 'activate', email: r.email }, r.email)}>Activate</Button>}
                    {r.blocked && <Button size="sm" variant="outline" disabled={busy === r.email} onClick={() => post({ op: 'unblock', email: r.email }, r.email)}>Unblock</Button>}
                    {canRoles && <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busy === r.email} onClick={() => remove(r.email)}>Remove</Button>}
                  </div>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">No non-admin team members yet. Add people on the Team page or enroll one above.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Auto-enroll (admin only) */}
      {data.role === 'admin' && <AutoEnroll data={data} onSaved={load} />}
    </section>
  );
}

function AutoEnroll({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [on, setOn] = useState(data.autoEnroll.on);
  const [roles, setRoles] = useState<string[]>(data.autoEnroll.roles);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/training/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'auto-enroll', on, roles }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || 'Could not save.'); return; }
      setMsg('Saved.'); onSaved();
    } finally { setBusy(false); }
  }
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <input id="auto-enroll" type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <label htmlFor="auto-enroll" className="text-sm font-medium">Auto-enroll on first login</label>
      </div>
      <p className="text-xs text-muted-foreground">When on, a qualifying @usaindiacfo.com person (of a ticked role, never admin) gets a training profile automatically the first time they sign in. Off by default.</p>
      <div className="flex flex-wrap gap-3">
        {data.roles.map((r) => (
          <label key={r} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} disabled={!on} /> {r}</label>
        ))}
      </div>
      <div className="flex items-center gap-2"><Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save auto-enroll'}</Button>{msg && <span className="text-xs text-muted-foreground">{msg}</span>}</div>
    </div>
  );
}

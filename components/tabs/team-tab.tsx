'use client';

// Team: who can sign in, their role, and who is blocked. Admins add people and change roles;
// admins and managers block or unblock (managers only users and analysts). The server enforces the
// same rules.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';
import { useRole } from '@/hooks/use-role';
import { canBlock, ROLES, type Role } from '@/lib/permissions';

const ROLE_TEXT: Record<Role, string> = {
  admin: 'Everything, including settings, AI credits and the team',
  manager: 'Sees reports, approves and edits strategy, assigns tasks, blocks users and analysts',
  analyst: 'Sees and downloads reports, does content work, sees AI credits',
  user: 'Sees the strategy, asks the assistant, does tasks assigned to them',
  tester: 'For 48 hours: everything except managing the team, then back to user automatically',
};
const fmt = (s: string) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

export default function TeamTab() {
  const me = useRole();
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState({ email: '', name: '', role: 'user' as Role });

  const load = useCallback(async () => {
    const res = await fetch('/api/team');
    if (res.ok) setRows(await res.json());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(body: any, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const isAdmin = me.can('team.roles');
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Team and roles</CardTitle>
          <CardDescription>
            Anyone with a company Google account can sign in and starts as a User. {isAdmin ? 'Change roles here.' : 'Only the admin can change roles.'} A blocked person can still look at the dashboard but cannot take any action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {ROLES.map((r) => (
              <li key={r}><span className="font-semibold capitalize">{r}:</span> <span className="text-muted-foreground">{ROLE_TEXT[r]}</span></li>
            ))}
          </ul>
          {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm">{error}</div>}
          <DataTable head={['Person', 'Role', 'Status', '']}>
            {rows.map((r) => {
              const blockable = canBlock(me.role, r.role, r.email) && !me.blocked;
              return (
                <tr key={r.email}>
                  <td className={TD}>
                    <div className="font-medium">{r.name || r.email}</div>
                    <div className="text-xs text-muted-foreground">{r.email}{r.owner ? ' (owner)' : ''}</div>
                  </td>
                  <td className={TD}>
                    {isAdmin && !r.owner ? (
                      <select className="h-8 rounded-md border bg-background px-2 capitalize" value={r.role} disabled={!!busy} onChange={(e) => save({ email: r.email, role: e.target.value }, `role-${r.email}`)}>
                        {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    ) : (
                      <span className="capitalize">{r.role}</span>
                    )}
                    {r.role === 'tester' && r.role_expires_at && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Ends {fmt(r.role_expires_at)}
                        {isAdmin && (
                          <button type="button" className="ml-2 text-primary underline" disabled={!!busy} onClick={() => save({ email: r.email, role: 'tester' }, `role-${r.email}`)}>
                            Renew for 48 hours from now
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={TD_MUTED}>{r.blocked ? <span className="font-medium text-red-600 dark:text-red-400">Blocked</span> : 'Active'}</td>
                  <td className={TD}>
                    {blockable && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save({ email: r.email, blocked: !r.blocked }, `block-${r.email}`)}>
                        {busy === `block-${r.email}` && <Loader2 className="animate-spin" />}
                        {r.blocked ? 'Unblock' : 'Block'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Add a person</CardTitle>
            <CardDescription>Give someone a role before their first sign-in. They sign in with their company Google account.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Input className="h-9 w-64" placeholder="name@usaindiacfo.com" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
            <Input className="h-9 w-48" placeholder="Name (optional)" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 capitalize" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Role })}>
              {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <Button
              disabled={!add.email.trim() || !!busy}
              onClick={async () => {
                if (await save({ email: add.email, name: add.name, role: add.role }, 'add')) setAdd({ email: '', name: '', role: 'user' });
              }}
            >
              {busy === 'add' ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Add
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

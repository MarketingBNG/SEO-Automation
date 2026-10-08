'use client';

// Activity log: every major action, who did it (or "Automatic" when the dashboard did it on its
// own), how (dashboard, assistant or automatic), and what it was. Filter by person, area or text.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SOURCE: Record<string, string> = { dashboard: 'Dashboard', assistant: 'Assistant', automatic: 'Automatic' };
const when = (s: string) =>
  s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';

export default function ActivityTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [live, setLive] = useState<any[]>([]);
  const [admin, setAdmin] = useState(true);
  const [person, setPerson] = useState('');
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (person) sp.set('person', person);
      if (area) sp.set('area', area);
      if (q.trim()) sp.set('q', q.trim());
      const j = await fetch(`/api/activity/list?${sp}`).then((r) => r.json());
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setPeople(j.people || []);
      setAreas(j.areas || []);
      setLive(j.live || []);
      setAdmin(j.admin !== false);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [person, area, q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const t = setTimeout(load, q ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          {admin ? 'Every major action by everyone: who did it, how, and what happened.' : 'Your actions and the automatic runs: what happened and whether it worked.'} &quot;Automatic&quot; means the dashboard did it on its own. A green light means it is running right now.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={load}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {live.length > 0 && (
          <ul className="space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm">
            {live.map((l) => (
              <li key={l.key} className="flex items-center gap-2">
                <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
                <span className="font-medium">Running now:</span> {l.label}
                <span className="text-xs text-muted-foreground">since {when(String(l.startedAt).replace('T', ' ').slice(0, 19))}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">{admin ? 'Everyone' : 'Me and automatic runs'}</option>
            <option value="automatic">Automatic (the dashboard itself)</option>
            {people.map((p) => (
              <option key={p.email} value={p.email}>{p.name} ({p.count})</option>
            ))}
          </select>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="">All areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Input className="h-9 w-56" placeholder="Search details" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (IST)</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap align-top text-muted-foreground">{when(e.created_at)}</TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{e.actor}</div>
                    <div className="text-xs text-muted-foreground">
                      {[e.role ? e.role[0].toUpperCase() + e.role.slice(1) : null, SOURCE[e.source || (e.actor_email ? 'dashboard' : 'automatic')]].filter(Boolean).join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">{e.area}</TableCell>
                  <TableCell className="align-top font-medium">{e.what}</TableCell>
                  <TableCell className="align-top">
                    <span className={`inline-flex items-center gap-1 text-xs ${e.outcome === 'failed' ? 'text-red-600 dark:text-red-400' : e.outcome === 'started' ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-400'}`}>
                      <span className={`size-2 rounded-full ${e.outcome === 'failed' ? 'bg-red-500' : e.outcome === 'started' ? 'bg-muted-foreground' : 'bg-emerald-500'}`} />
                      {e.outcome === 'failed' ? 'Failed' : e.outcome === 'started' ? 'Started' : 'Done'}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-[240px] whitespace-normal align-top text-muted-foreground">{e.details}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No activity matches these filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

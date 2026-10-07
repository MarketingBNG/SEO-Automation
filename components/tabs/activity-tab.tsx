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
        <CardDescription>Every major action: who did it, how, and what happened. &quot;Automatic&quot; means the dashboard did it on its own.</CardDescription>
        <CardAction>
          <Button variant="outline" onClick={load}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
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
                  <TableCell className="min-w-[240px] whitespace-normal align-top text-muted-foreground">{e.details}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No activity matches these filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

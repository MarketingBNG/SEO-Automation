'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';

// Every pick of the approved monthly strategy, on the Keywords page: what to write or fix, for
// which keyword, and one click to start it. "New blog" picks go into the blog queue below;
// refresh / service-page / merge picks start an audit of the existing page (Blog Audit tab).
const PLAN: Record<string, string> = {
  new: 'New blog',
  refresh: 'Refresh page',
  service_page: 'Service page',
  consolidate: 'Merge pages',
};

export function StrategyPlanCard({ onQueued }: { onQueued?: () => void }) {
  const [strategy, setStrategy] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await fetch('/api/strategy').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setStrategy((Array.isArray(list) ? list : []).find((s: any) => s.status === 'approved') || null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const picks: any[] = strategy?.report ? [...(strategy.report.picks || []), ...(strategy.report.quickEdits || [])] : [];
  const isNew = (p: any) => p.action === 'new';
  const done = (p: any) => (isNew(p) ? p.status?.keywordId : p.status?.auditId);
  const todo = picks.filter((p) => !done(p) && (isNew(p) ? p.keyword : p.targetUrl));

  async function act(p: any) {
    const res = await fetch(`/api/strategy/${strategy.id}/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: p.index, action: isNew(p) ? 'pipeline' : 'audit' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setStrategy(json);
  }

  async function run(list: any[]) {
    setError(null);
    for (const p of list) {
      setBusy(String(p.index));
      try {
        await act(p);
      } catch (err: any) {
        setError(`${p.keyword || p.targetUrl}: ${err.message}`);
        break;
      }
    }
    setBusy(null);
    onQueued?.();
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This month&apos;s strategy plan{strategy ? ` (${strategy.period})` : ''}</CardTitle>
        <CardDescription>
          {strategy
            ? 'Every pick from the approved strategy. New blogs go into the queue below; refresh, service-page and merge picks start an audit of the existing page, which you then review in Blog Audit.'
            : 'No approved strategy yet. Generate and approve one in Monthly Strategy and its keywords will show here.'}
        </CardDescription>
      </CardHeader>
      {strategy && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run(todo)} disabled={!!busy || !todo.length}>
              {busy && <Loader2 className="animate-spin" />}
              {todo.length ? `Start all ${todo.length}` : 'All started'}
            </Button>
            <span className="text-muted-foreground text-sm">Audits take about a minute each.</span>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <DataTable head={['Keyword', 'Plan', 'Page / title', 'Priority', '']}>
            {picks.map((p) => (
              <tr key={p.index} className="border-t">
                <td className={TD}>{p.keyword || '-'}</td>
                <td className={TD_MUTED}>{PLAN[p.action] || p.action}</td>
                <td className={TD_MUTED + ' max-w-[320px] break-words'}>{p.targetUrl || p.workingTitle || '-'}</td>
                <td className={TD_MUTED}>{p.score?.priority ?? '-'}</td>
                <td className={TD}>
                  {done(p) ? (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400">
                      {isNew(p) ? 'In blog queue' : 'Audit ready in Blog Audit'}
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!!busy || !(isNew(p) ? p.keyword : p.targetUrl)} onClick={() => run([p])}>
                      {busy === String(p.index) && <Loader2 className="animate-spin" />}
                      {isNew(p) ? 'Add to blog queue' : 'Start audit'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </CardContent>
      )}
    </Card>
  );
}

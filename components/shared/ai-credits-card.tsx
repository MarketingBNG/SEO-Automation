'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';

const usd = (n: number | null | undefined) => (n === null || n === undefined ? 'Not set' : `$${n.toFixed(2)}`);
const FEATURE: Record<string, string> = {
  strategy: 'Strategy research',
  blog: 'Blog writing',
  'fact-check': 'Fact checking',
  reports: 'Report explanations',
  meetings: 'Meeting cleaning',
  assistant: 'Assistant',
  audit: 'Blog audit and rewrite',
  training: 'Writing skill refresh',
  other: 'Other',
};

// AI credits: which models run, what they cost, estimated credit left, and the automatic pause.
export function AiCreditsCard() {
  const [s, setS] = useState<any>(null);
  const [balance, setBalance] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/ai-credits').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (j) setS(j);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Spend moves slowly; a check every 2 minutes is enough (each one can ask Anthropic's cost report).
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [load]);

  async function post(body: any) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setS(j);
      setBalance('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const low = s.remaining !== null && s.remaining < s.threshold * 2;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI credits and spend</CardTitle>
        <CardDescription>
          Anthropic does not report your remaining balance through the API, so the dashboard counts the cost of every Claude call from its token usage at Anthropic&apos;s published prices, and checks it against Anthropic&apos;s own cost report when an Admin API key is set (ANTHROPIC_ADMIN_KEY). Enter your balance after each top-up; an alert goes out when 80% of it is used. When the estimated credit left drops below the pause level, or Anthropic says the account is out of credit, all AI work pauses until you update the balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {s.paused && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <div className="font-semibold">AI work is paused</div>
            <div>{s.pauseReason}</div>
            <div className="mt-1 text-muted-foreground">Add credits at console.anthropic.com (Settings &gt; Billing), enter the new balance below, then press Resume on any paused strategy.</div>
            <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => post({ action: 'resume' })}>Resume without changing the balance</Button>
          </div>
        )}
        {s.alert80 && !s.paused && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="font-semibold">{s.usedPercent}% of the balance is used</div>
            <div className="text-muted-foreground">Top up at console.anthropic.com (Settings &gt; Billing). Turning on auto-reload there keeps work from stopping. Then enter the new balance below.</div>
          </div>
        )}
        {s.actual && (
          <div className="rounded-lg border p-3">
            {'error' in s.actual ? (
              <span className="text-muted-foreground">Could not read Anthropic&apos;s cost report: {s.actual.error}</span>
            ) : (
              <span>
                Anthropic&apos;s own cost report since {s.actual.from}: <strong>{usd(s.actual.usd)}</strong> (the dashboard&apos;s count: {usd(s.spentSinceBalance)}).{' '}
                <span className="text-muted-foreground">Anthropic&apos;s report is by whole day and can lag a few minutes, so small differences are normal.</span>
              </span>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className={`rounded-lg border p-3 ${low ? 'border-amber-500/50' : ''}`}><div className="text-muted-foreground">Estimated credit left</div><div className="text-lg font-semibold">{usd(s.remaining)}</div><div className="text-xs text-muted-foreground">of {usd(s.balance)} entered {s.balanceSetAt ? `on ${s.balanceSetAt.slice(0, 10)}` : ''}{s.usedPercent !== null ? `, ${s.usedPercent}% used` : ''}</div>{s.usedPercent !== null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full ${s.usedPercent >= 80 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${s.usedPercent}%` }} /></div>}</div>
          <div className="rounded-lg border p-3"><div className="text-muted-foreground">Spent, last 24 hours</div><div className="text-lg font-semibold">{usd(s.spent.last24h)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-muted-foreground">Spent, last 7 days</div><div className="text-lg font-semibold">{usd(s.spent.last7d)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-muted-foreground">Spent, last 30 days</div><div className="text-lg font-semibold">{usd(s.spent.last30d)}</div></div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1"><span className="text-muted-foreground">Current balance (USD)</span><Input className="h-8 w-40" type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="e.g. 100" /></label>
          <label className="grid gap-1"><span className="text-muted-foreground">Pause when below (USD)</span><Input className="h-8 w-40" type="number" min="0" step="0.5" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={String(s.threshold)} /></label>
          <Button size="sm" disabled={busy || balance === ''} onClick={() => post({ action: 'set_balance', balance, threshold })}>{busy && <Loader2 className="animate-spin" />}Save balance</Button>
          {!s.paused && <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: 'pause' })}>Pause all AI work now</Button>}
        </div>
        {error && <div className="text-destructive">{error}</div>}
        <div>
          <div className="mb-1 font-semibold">Models in use</div>
          <DataTable head={['Used for', 'Model', 'Input per 1M tokens', 'Output per 1M tokens']}>
            {[['Blog writing', s.models.writer], ['Strategy research', s.models.strategy], ['Fact checking', s.models.factCheck], ['Second fact check', s.models.secondCheck], ['Assistant', s.models.assistant]].map(([k, m]) => (
              <tr key={k}><td className={TD}>{k}</td><td className={TD}>{m}</td><td className={TD_MUTED}>${s.prices[m]?.input}</td><td className={TD_MUTED}>${s.prices[m]?.output}</td></tr>
            ))}
          </DataTable>
          <div className="mt-1 text-xs text-muted-foreground">Web searches cost ${s.webSearchPer1000} per 1,000. The writing skill refresh runs at half price (batch).</div>
        </div>
        <div>
          <div className="mb-1 font-semibold">Where the credits went (last 30 days)</div>
          {s.byFeature.length ? (
            <DataTable head={['Feature', 'Calls', 'Web searches', 'Tokens in / out', 'Cost']}>
              {s.byFeature.map((f: any) => (
                <tr key={f.feature}><td className={TD}>{FEATURE[f.feature] || f.feature}</td><td className={TD_MUTED}>{f.calls}</td><td className={TD_MUTED}>{f.webSearches}</td><td className={TD_MUTED}>{f.inputTokens.toLocaleString()} / {f.outputTokens.toLocaleString()}</td><td className={TD}>{usd(f.cost)}</td></tr>
              ))}
            </DataTable>
          ) : (
            <div className="text-muted-foreground">No AI calls recorded yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

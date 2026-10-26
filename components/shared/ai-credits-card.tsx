'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';

const inr = (n: number, fx: { rate: number } | null | undefined) => (fx ? ` (₹${Math.round(n * fx.rate).toLocaleString('en-IN')})` : '');
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
  skills: 'Creative skills (from YouTube)',
  other: 'Other',
};

// AI credits: which models run, what they cost, estimated credit left, and the automatic pause.
export function AiCreditsCard() {
  const [s, setS] = useState<any>(null);
  const [balance, setBalance] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyTest, setKeyTest] = useState<any[] | null>(null);

  async function testKeys() {
    setBusy(true);
    setError(null);
    try {
      const j = await fetch('/api/ai-credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test_keys' }) }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setS(j);
      setKeyTest(j.keyTest);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

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
      setS((prev: any) => ({ ...prev, ...j }));
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
        {/* Testing mode (Claude Code subscription) or Live mode (API credits), like the Social Media dashboard. */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 font-semibold">Testing mode</div>
          {s.aiMode === 'testing' ? (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
              <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><FlaskConical className="size-4" />Testing mode is ON</div>
              <div className="text-amber-900/80 dark:text-amber-200/80">
                All AI work runs on the Claude Code subscription. No Anthropic API credits are used. Work you start (a blog, Check a blog, a fact check, a strategy) waits in the queue below until Claude Code answers it: open Claude Code and say &quot;run the SEO AI queue&quot;. Automatic work (the daily schedule) does not start, and the assistant chat is off.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <div className="font-semibold">Live mode is ON</div>
              <div className="text-muted-foreground">All AI work uses Anthropic API credits and runs on its own, including the daily schedule.</div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {s.aiMode === 'testing' ? (
              <Button size="sm" disabled={busy} onClick={() => window.confirm('Switch to Live mode? AI work will use API credits again, and automatic work starts again.') && post({ action: 'mode', mode: 'live' })}>Switch to Live mode (use API credits)</Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => post({ action: 'mode', mode: 'testing' })}><FlaskConical />Switch to Testing mode (Claude Code subscription)</Button>
            )}
            {!s.paused && <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: 'pause' })}>Pause all AI work now</Button>}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Work is saved step by step either way, so switching modes never loses work.</div>
          {s.aiMode === 'testing' && (
            <div className="mt-3">
              <div className="mb-1 font-medium">Waiting for Claude Code: {s.queue?.waiting || 0}</div>
              {(s.queue?.jobs || []).length > 0 && (
                <ul className="space-y-1 text-xs">
                  {s.queue.jobs.map((j: any) => (
                    <li key={j.id} className="flex items-start gap-2">
                      <span className="shrink-0 tabular-nums text-muted-foreground">#{j.id}</span>
                      <span className="shrink-0 font-medium">{FEATURE[j.feature] || j.feature}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={j.label}>{j.label}</span>
                      <button type="button" className="shrink-0 text-red-600 underline dark:text-red-400" disabled={busy} onClick={() => window.confirm(`Cancel job #${j.id}? The work that asked for it stops.`) && post({ action: 'cancel_job', id: j.id })}>Cancel</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
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
        {s.apiKeys && (
          <div className={`rounded-lg border p-3 ${s.apiKeys.inUse === 'secondary' ? 'border-amber-500/50 bg-amber-500/10' : ''}`}>
            {!s.apiKeys.secondaryConfigured
              ? 'API keys: main key only. Set ANTHROPIC_API_KEY_SECONDARY on the server to have a backup key take over when the main one runs out of credit.'
              : s.apiKeys.inUse === 'secondary'
                ? 'API keys: the main key ran out of credit, so the secondary key is in use. The main key is tried again every hour, or right after you save a new balance below.'
                : 'API keys: the main key is in use. The secondary key takes over automatically if the main one runs out of credit, so the low-credit pause waits until both are out.'}
            <div className="mt-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={testKeys}>
                Test both keys
              </Button>
            </div>
            {keyTest && (
              <ul className="mt-2 space-y-1 text-sm">
                {keyTest.map((k: any) => (
                  <li key={k.which}>
                    <strong>{k.which === 'main' ? 'Main key' : 'Secondary key'}</strong>
                    {k.ending ? ` (…${k.ending})` : ''}:{' '}
                    <span className={k.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>{k.ok ? 'works' : `${k.status ? `HTTP ${k.status}: ` : ''}${k.message}`}</span>
                    {k.sameAsMain && <span className="text-destructive"> This is the same key as the main one: put the key from the other account here.</span>}
                    {k.configured && !k.apiKeyFormat && <span className="text-destructive"> This is not an API key (it should start with sk-ant-api03-).</span>}
                  </li>
                ))}
              </ul>
            )}
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
        {s.month?.remaining && (
          <div className="rounded-lg border border-primary/40 p-3">
            <div className="mb-1 font-semibold">Budget to keep for the rest of this month</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><div className="text-muted-foreground">Days left</div><div className="text-lg font-semibold">{s.month.remaining.daysLeft}</div><div className="text-xs text-muted-foreground">{s.month.remaining.blogsLeft} blog(s) still to write and check</div></div>
              <div><div className="text-muted-foreground">Keep in the API account</div><div className="text-lg font-semibold">{usd(s.month.budget.keep)}{inr(s.month.budget.keep, s.month.usdInr)}</div><div className="text-xs text-muted-foreground">Work left {usd(s.month.remaining.cost)} plus a 25% margin</div></div>
              <div><div className="text-muted-foreground">Add now</div><div className="text-lg font-semibold">{usd(s.month.budget.topUp)}{inr(s.month.budget.topUp, s.month.usdInr)}</div><div className="text-xs text-muted-foreground">After the {usd(s.month.budget.creditLeft)} credit already there</div></div>
            </div>
            {s.month.usdInr && <div className="mt-1 text-xs text-muted-foreground">Rupees at ₹{s.month.usdInr.rate.toFixed(2)} per US$ (updated {s.month.usdInr.at.slice(0, 10)}); your card may add bank charges.</div>}
          </div>
        )}
        {s.month && (
          <div className="rounded-lg border p-3">
            <div className="mb-1 font-semibold">This month</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><div className="text-muted-foreground">Spent so far</div><div className="text-lg font-semibold">{usd(s.month.spent)}</div></div>
              <div>
                <div className="text-muted-foreground">Work still left (estimate)</div>
                <div className="text-lg font-semibold">{s.month.remaining ? usd(s.month.remaining.cost) : 'No approved strategy'}</div>
                {s.month.remaining && <div className="text-xs text-muted-foreground">{s.month.remaining.blogsLeft} blog(s) x {usd(s.month.remaining.perBlog)}, plus {s.month.remaining.daysLeft} day(s) of daily work x {usd(s.month.remaining.daily)}</div>}
              </div>
              <div><div className="text-muted-foreground">Expected for the month</div><div className="text-lg font-semibold">{usd(s.month.expectedTotal)}</div><div className="text-xs text-muted-foreground">Top up at least this much, less the credit left.</div></div>
            </div>
            {s.month.byFeature.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Spent by work: {s.month.byFeature.map((f: any) => `${FEATURE[f.feature] || f.feature} ${usd(f.cost)}`).join(', ')}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1"><span className="text-muted-foreground">Current balance (USD)</span><Input className="h-8 w-40" type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="e.g. 100" /></label>
          <label className="grid gap-1"><span className="text-muted-foreground">Pause when below (USD)</span><Input className="h-8 w-40" type="number" min="0" step="0.5" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={String(s.threshold)} /></label>
          <Button size="sm" disabled={busy || balance === ''} onClick={() => post({ action: 'set_balance', balance, threshold })}>{busy && <Loader2 className="animate-spin" />}Save balance</Button>
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

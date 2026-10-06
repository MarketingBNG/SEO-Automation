'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from 'cn';

// Two panels used on a blog: which keywords it should use and does use (KeywordPanel), and how it
// performs in Google and GA4 with the keywords it ranks for (BlogAnalytics). BlogTable lists every
// published blog with its clicks and top keywords.

const fmt = (n: any) => Number(n).toLocaleString('en-US');
const shortUrl = (u: any) => String(u || '').replace(/^https?:\/\/(www\.)?usaindiacfo\.com/, '') || '/';
const STATE: Record<string, { badge: string; label: string }> = {
  used: { badge: 'approved', label: 'used' },
  variant: { badge: 'approved', label: 'used in other words' },
  partly: { badge: 'gold', label: 'partly' },
  missing: { badge: 'failed', label: 'not in the article' },
};

// ---- small building blocks (restyled copies of the old Performance helpers) ----

const Box = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mt-3 rounded-xl border bg-card p-4 text-card-foreground', className)}>{children}</div>
);

const Banner = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm', className)}>{children}</div>
);

const Muted = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
);

export function PeriodSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Period"
      className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      <option value={28}>Last 28 days</option>
      <option value={56}>Last 56 days</option>
      <option value={90}>Last 90 days</option>
    </select>
  );
}

function DataTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
const td = 'px-3 py-2 align-top';
const tdMuted = 'px-3 py-2 align-top text-muted-foreground';

function Change({ k }: { k: any }) {
  if (k.changePct === null || k.changePct === undefined || k.now === k.before) return <span className="text-muted-foreground">no change</span>;
  const good = k.lowerIsBetter ? k.changePct < 0 : k.changePct > 0;
  return (
    <span className={good ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
      {k.changePct > 0 ? '+' : ''}
      {k.changePct}% vs before
    </span>
  );
}

function Kpis({ kpis }: { kpis: any[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-lg border bg-muted/30 p-3" title={k.note}>
          <div className="text-xs text-muted-foreground">{k.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {fmt(k.now)}
            {k.unit}
          </div>
          <div className="text-xs">
            <Change k={k} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{k.note || `Before: ${fmt(k.before)}${k.unit}`}</div>
        </div>
      ))}
    </div>
  );
}

const COLORS = ['#3b5bdb', '#D7392E', '#5BB947', '#D4AF37', '#E85A2C'];

// Weekly line chart. The dashed line marks where "this period" starts, so the left part of the
// graph is the previous period for comparison.
function LineChart({ title, labels, series, splitAt }: { title: string; labels: any[]; series: any[]; splitAt: number }) {
  const W = 760;
  const H = 250;
  const pad = { l: 52, r: 14, t: 34, b: 28 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => pad.l + (labels.length > 1 ? (i / (labels.length - 1)) * w : w / 2);
  const y = (v: number) => pad.t + h - (v / max) * h;
  return (
    <div className="mt-3 rounded-lg border p-3">
      <div className="mb-1 text-sm font-medium">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={title}>
        {series.map((s, k) => (
          <g key={s.name}>
            <rect x={pad.l + k * 190} y={8} width={10} height={10} fill={COLORS[k % COLORS.length]} rx={2} />
            <text x={pad.l + k * 190 + 15} y={17} fontSize={11} fill="currentColor">{s.name}</text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity={0.15} />
            <text x={pad.l - 6} y={y(max * f) + 4} fontSize={11} textAnchor="end" fill="currentColor" opacity={0.7}>{fmt(Math.round(max * f))}</text>
          </g>
        ))}
        {splitAt > 0 && splitAt < labels.length && (
          <g>
            <line x1={x(splitAt) - (x(1) - x(0)) / 2} x2={x(splitAt) - (x(1) - x(0)) / 2} y1={pad.t} y2={pad.t + h} stroke="#D4AF37" strokeDasharray="4 4" />
            <text x={x(splitAt) - (x(1) - x(0)) / 2 + 6} y={pad.t + 12} fontSize={10} fill="#D4AF37">this period</text>
            <text x={x(splitAt) - (x(1) - x(0)) / 2 - 6} y={pad.t + 12} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.6}>previous period</text>
          </g>
        )}
        {labels.map((l, i) => (i % 2 === 0 ? <text key={i} x={x(i)} y={H - 8} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.7}>{l}</text> : null))}
        {series.map((s, k) => {
          const c = COLORS[k % COLORS.length];
          return (
            <g key={s.name}>
              <polyline points={s.values.map((v: number, i: number) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={c} strokeWidth={2.5} />
              {s.values.map((v: number, i: number) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={c}>
                  <title>{`${s.name}, week of ${labels[i]}: ${fmt(v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Table({ title, note, rows, cols, empty }: { title: string; note?: string; rows: any[]; cols: any[]; empty?: string }) {
  return (
    <div className="mt-4">
      <div className="text-sm font-medium">{title}</div>
      {note && <Muted className="mt-0.5 mb-1.5">{note}</Muted>}
      {rows && rows.length > 0 ? (
        <div className="mt-1.5">
          <DataTable head={cols.map((c) => c.label)}>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-muted/30">
                {cols.map((c) => <td key={c.key} className={c.muted ? tdMuted : td}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
          </DataTable>
        </div>
      ) : (
        <Muted>{empty || 'None this period.'}</Muted>
      )}
    </div>
  );
}

function Group({ title, help, children, empty }: { title: string; help: ReactNode; children?: ReactNode; empty?: string }) {
  return (
    <div className="mt-4">
      <div className="text-sm font-medium">{title}</div>
      <Muted className="mt-0.5 mb-1.5">{help}</Muted>
      {children || <Muted>{empty}</Muted>}
    </div>
  );
}

function Pill({ state }: { state: string }) {
  const s = STATE[state] || STATE.missing;
  return <StatusBadge status={s.badge}>{s.label}</StatusBadge>;
}

export function KeywordPanel({ draftId, refreshKey }: { draftId: any; refreshKey?: any }) {
  const [a, setA] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drafts/${draftId}/keywords`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setA(json);
    } catch (err: any) {
      setError(err.message);
    }
  }, [draftId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    setA(null);
    load();
  }, [load, refreshKey]);

  async function fetchPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/keywords`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setA(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !a) return <Box><Muted>Keywords: {error}</Muted></Box>;
  if (!a) return <Box><Muted className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Checking keywords…</Muted></Box>;
  const p = a.primary;
  const H = a.typeHelp;

  return (
    <Box>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>Keywords for this blog</strong>
        {a.hasPlan ? <span className="text-xs text-muted-foreground">Suggestions from {String(a.planBuiltAt).slice(0, 10)}; usage is checked on the text as it is now</span> : null}
      </div>

      {p && (
        <Group title="Primary keyword" help={H.primary}>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{p.keyword}</strong>
            <Pill state={p.status} />
            <span className="text-sm text-muted-foreground">used {p.count}× ({p.densityPct}% of words)</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {([['Title', p.inTitle], ['First 100 words', p.inOpening], ['A heading', p.inHeading], ['Meta description', p.inMeta]] as [string, boolean][]).map(([l, ok]) => (
              <StatusBadge key={l} status={ok ? 'approved' : 'failed'}>{ok ? <Check className="size-3" /> : <X className="size-3" />} {l}</StatusBadge>
            ))}
          </div>
          {p.advice.length > 0 && <ul className="mt-1.5 list-disc pl-5 text-sm">{p.advice.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>}
        </Group>
      )}

      {!a.hasPlan && (
        <Banner>
          No keyword suggestions were saved for this draft. Do the keyword research now (SE Ranking plus live Google checks, no AI credit; takes up to 2 minutes).
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={fetchPlan} disabled={busy}>{busy ? 'Researching…' : 'Do keyword research'}</Button>
          </div>
          {error && <Muted>Error: {error}</Muted>}
        </Banner>
      )}

      {a.suggestions.length > 0 && (
        <Banner>
          <strong>What to change:</strong>
          <ul className="mt-1 list-disc pl-5">{a.suggestions.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
        </Banner>
      )}

      {a.hasPlan && (
        <>
          <Group
            title={`Planned secondary keywords (${a.secondary.filter((k: any) => k.status !== 'missing').length} of ${a.secondary.length} in the article)`}
            help={`${H.secondary} Near-identical searches are grouped, because Google treats them as one search and repeating each would be keyword stuffing.`}
            empty="No distinct secondary keywords were found for this topic."
          >
            {a.secondary.length > 0 && (
              <DataTable head={['Keyword to use', 'Searches / month', 'Difficulty', 'Where to put it', 'In this blog']}>
                {a.secondary.map((k: any, i: number) => (
                  <tr key={k.keyword}>
                    <td className={td}>
                      {k.keyword}
                      {k.variants?.length > 0 && <div className="text-xs text-muted-foreground">same search: {k.variants.slice(0, 3).join(', ')}</div>}
                    </td>
                    <td className={tdMuted}>{k.volume ?? '-'}</td>
                    <td className={tdMuted}>{k.difficulty ?? '-'}</td>
                    <td className={tdMuted}>{i < 3 ? 'A heading, plus the text under it' : 'Body text, once or twice'}</td>
                    <td className={td}>
                      <Pill state={k.status} />
                      {k.matched && k.matched !== k.keyword && <div className="text-xs text-muted-foreground">as &quot;{k.matched}&quot;</div>}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
            {a.coveredByPrimary?.length > 0 && (
              <Muted className="mt-2">
                Already covered by the primary keyword (no need to add them): {a.coveredByPrimary.map((c: any) => c.keyword).join(', ')}.
              </Muted>
            )}
          </Group>

          <Group title={`Question keywords (${a.questions.filter((q: any) => q.status === 'used').length} of ${a.questions.length} answered)`} help={H.question} empty="None found.">
            {a.questions.length > 0 && (
              <DataTable head={['Question', 'From', 'In this blog']}>
                {a.questions.map((q: any) => (
                  <tr key={q.keyword}>
                    <td className={td}>{q.keyword}</td>
                    <td className={tdMuted}>{q.source}{q.markets?.length ? ` (${q.markets.join(', ')})` : ''}</td>
                    <td className={td}><Pill state={q.status} /></td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Group>

          <Group title="Related searches (long-tail)" help={H.related} empty="None found.">
            {a.related.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.related.map((k: any) => <StatusBadge key={k.keyword} status={STATE[k.status].badge} title={STATE[k.status].label}>{k.keyword}</StatusBadge>)}
              </div>
            )}
          </Group>

          {a.surfer.length > 0 && (
            <Group title="Surfer terms (coverage checklist)" help={H.surfer}>
              <DataTable head={['Term', 'Top pages use', 'This blog', '']}>
                {a.surfer.map((t: any) => (
                  <tr key={t.term}>
                    <td className={td}>{t.term}</td>
                    <td className={tdMuted}>{t.min ?? '-'}{t.max ? ` to ${t.max}` : '+'}</td>
                    <td className={tdMuted}>{t.count}×</td>
                    <td className={tdMuted}>{t.note}</td>
                  </tr>
                ))}
              </DataTable>
            </Group>
          )}
        </>
      )}

      {a.ownPages?.length > 0 && (
        <Group title="Our pages already showing for these searches" help="Do not write a near-copy of these: cover a different angle and link to the relevant one.">
          <ul className="list-disc pl-5 text-sm">{a.ownPages.map((o: any, i: number) => <li key={i}>&quot;{o.query}&quot; at position {o.position} on {shortUrl(o.page)} ({o.impressions} impressions)</li>)}</ul>
        </Group>
      )}

      <Group title="What the article actually leans on" help="The phrases and terms it repeats most, so you can see its real focus (forms, sections, agencies).">
        <div className="flex flex-wrap gap-1.5">
          {a.frequentPhrases.map((f: any) => <StatusBadge key={f.phrase} status="pending">{f.phrase} ×{f.count}</StatusBadge>)}
          {a.entities.map((e: any) => <StatusBadge key={e.entity} status="gold">{e.entity} ×{e.count}</StatusBadge>)}
        </div>
      </Group>
    </Box>
  );
}

const KIND: Record<string, string> = { brand: 'brand name', question: 'question', 'long-tail': 'long-tail', short: 'short' };

export function BlogAnalytics({ url, keyword, title }: { url: any; keyword?: any; title?: any }) {
  const [days, setDays] = useState(28);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    setLoading(true);
    setError(null);
    setD(null);
    fetch(`/api/blog-analytics?url=${encodeURIComponent(url)}&days=${days}&keyword=${encodeURIComponent(keyword || '')}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      })
      .then((j) => !cancelled && setD(j))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, keyword, days]);

  return (
    <Box>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>How this blog performs{title ? `: ${title}` : ''}</strong>
        <PeriodSelect value={days} onChange={setDays} />
      </div>
      {loading && <Muted className="mt-2 flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading Google and GA4 data…</Muted>}
      {error && <Muted className="mt-2">Error: {error}</Muted>}
      {d && !d.live && <Muted className="mt-2">{d.message}</Muted>}
      {d && d.live && (
        <>
          <p className="mt-2 text-sm">{d.headline}</p>
          <Muted>{d.ranges.current.startDate} to {d.ranges.current.endDate} compared with {d.ranges.previous.startDate} to {d.ranges.previous.endDate}.</Muted>
          <Kpis kpis={d.kpis} />
          <LineChart title="Google clicks and visits per week" labels={d.series.labels} splitAt={d.splitAt} series={[{ name: 'Google clicks', values: d.series.clicks }, { name: 'Visits (GA4)', values: d.series.visits }]} />
          <LineChart title="Impressions per week" labels={d.series.labels} splitAt={d.splitAt} series={[{ name: 'Impressions', values: d.series.impressions }]} />

          <Table
            title={`Keywords this blog ranks for (${d.keywordCount} searches${d.keywordCount > d.keywords.length ? `, top ${d.keywords.length} shown` : ''})`}
            note="Position 1 is the top of Google. New means it did not show for this search in the previous period."
            rows={d.keywords}
            empty="Google has not shown this page for any search yet."
            cols={[
              { key: 'query', label: 'Search', render: (k: any) => <>{k.query}{k.isTarget && <StatusBadge status="gold" className="ml-1.5">target</StatusBadge>}{k.isNew && <StatusBadge status="approved" className="ml-1.5">new</StatusBadge>}</> },
              { key: 'kind', label: 'Type', muted: true, render: (k: any) => KIND[k.kind] },
              { key: 'position', label: 'Position', muted: true, render: (k: any) => (k.positionBefore ? `${k.position} (was ${k.positionBefore})` : k.position) },
              { key: 'band', label: 'Where', muted: true },
              { key: 'impressions', label: 'Impressions', muted: true },
              { key: 'clicks', label: 'Clicks', muted: true, render: (k: any) => `${k.clicks}${k.clicksBefore ? ` (was ${k.clicksBefore})` : ''}` },
              { key: 'ctr', label: 'CTR %', muted: true },
            ]}
          />

          {d.opportunities.length > 0 && (
            <Banner>
              <strong>What to improve on this blog:</strong>
              <ul className="mt-1 list-disc pl-5">{d.opportunities.map((o: string, i: number) => <li key={i}>{o}</li>)}</ul>
            </Banner>
          )}

          <Table title="Where the visits come from (this period, GA4)" rows={d.channels} empty="No GA4 visits recorded for this page." cols={[{ key: 'channel', label: 'Channel' }, { key: 'sessions', label: 'Visits', muted: true }, { key: 'engaged', label: 'Engaged', muted: true }, { key: 'avgSeconds', label: 'Avg. time (sec)', muted: true }, { key: 'conversions', label: 'Conversions', muted: true }]} />
          <Table title="Countries (Google clicks)" rows={d.countries.filter((c: any) => c.impressions > 0).slice(0, 6)} cols={[{ key: 'country', label: 'Country' }, { key: 'impressions', label: 'Impressions', muted: true }, { key: 'clicks', label: 'Clicks', muted: true }]} />
          {Object.keys(d.errors || {}).length > 0 && <Muted className="mt-2">Some data could not be read: {Object.entries(d.errors).map(([k, v]) => `${k} (${String(v).slice(0, 80)})`).join('; ')}</Muted>}
        </>
      )}
    </Box>
  );
}

// Every published blog, best first, with change vs the previous period and its top keywords.
export function BlogTable({ onOpen }: { onOpen: (row: any) => void }) {
  const [days, setDays] = useState(28);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(15);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    setD(null);
    setError(null);
    fetch(`/api/blog-analytics?days=${days}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [days]);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle>How each published blog performs</CardTitle>
          <CardDescription>Google clicks and the searches each blog ranks for, compared with the previous period. Click a blog to see its full analytics.</CardDescription>
        </div>
        <PeriodSelect value={days} onChange={setDays} />
      </CardHeader>
      <CardContent>
        {error && <Muted>Error: {error}</Muted>}
        {!d && !error && <Muted className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading…</Muted>}
        {d && (
          <>
            <Muted className="mb-3">{d.total} published blogs: {d.withTraffic} got clicks, {d.noImpressions} were not shown in Google at all in this period.</Muted>
            <DataTable head={['Blog', 'Clicks', 'Change', 'Impressions', 'Position', 'Top keywords', '']}>
              {d.rows.slice(0, show).map((r: any) => (
                <tr key={r.url} className="hover:bg-muted/30">
                  <td className={td}>
                    <button type="button" onClick={() => onOpen(r)} className="text-left font-medium hover:underline">{r.title}</button>
                    <a href={r.url} target="_blank" rel="noreferrer" className="ml-1 text-xs text-muted-foreground hover:underline">open page</a>
                    <div className="text-xs text-muted-foreground">updated {r.modified}</div>
                  </td>
                  <td className={cn(td, 'tabular-nums')}>{fmt(r.clicks)}</td>
                  <td className={td}>
                    <span className={r.change > 0 ? 'text-emerald-600 dark:text-emerald-400' : r.change < 0 ? 'text-destructive' : 'text-muted-foreground'}>{r.change > 0 ? '+' : ''}{r.change}</span>
                  </td>
                  <td className={cn(tdMuted, 'tabular-nums')}>{fmt(r.impressions)}</td>
                  <td className={tdMuted}>{r.position ?? '-'}</td>
                  <td className={tdMuted}>{r.topKeywords.map((k: any) => `${k.query} (#${k.position})`).join(', ') || '-'}{r.keywordCount > 3 ? ` +${r.keywordCount - 3} more` : ''}</td>
                  <td className={td}><Button type="button" variant="outline" size="sm" onClick={() => onOpen(r)}><BarChart3 />Analytics</Button></td>
                </tr>
              ))}
            </DataTable>
            {show < d.rows.length && <div className="mt-2"><Button variant="outline" size="sm" onClick={() => setShow(show + 30)}>Show more</Button></div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

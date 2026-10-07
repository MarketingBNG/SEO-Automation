'use client';

import { BusinessResults } from '@/components/shared/business-results';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart as ReLineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Download, Loader2, RefreshCcw } from 'lucide-react';
import { useRole } from '@/hooks/use-role';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Banner, DataTable, KpiTile, NativeSelect, SectionLabel, StatusBadge, type Col } from '@/components/shared/ui-bits';

// SEO, AEO, GEO and the overall report. All numbers come from /api/performance (computed in code
// from Search Console, GA4, WordPress, SE Ranking and the latest strategy run), with the previous
// period beside each one.

const COLORS = ['#3b5bdb', '#D7392E', '#5BB947', '#D4AF37', '#E85A2C'];
const STATUS: Record<string, { label: string; badge: string }> = {
  good: { label: 'Doing well', badge: 'approved' },
  watch: { label: 'Needs watching', badge: 'gold' },
  bad: { label: 'Needs attention', badge: 'failed' },
  unknown: { label: 'Not enough data', badge: 'pending' },
};
const PILLARS: Record<string, { title: string; sub: string }> = {
  seo: { title: 'SEO', sub: 'Rankings and search traffic (the classic Google results)' },
  aeo: { title: 'AEO', sub: 'Answer engines: question searches, People Also Ask and FAQs' },
  geo: { title: 'GEO', sub: 'Generative AI: visits from ChatGPT, Gemini and others, and AI Overviews' },
};

const fmt = (n: any) => Number(n).toLocaleString('en-US');

export function Change({ k }: { k: any }) {
  if (k.changePct === null || k.changePct === undefined || k.now === k.before) return <span className="text-muted-foreground">no change</span>;
  const good = k.lowerIsBetter ? k.changePct < 0 : k.changePct > 0;
  return (
    <span className={good ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-600 dark:text-red-400'}>
      {k.changePct > 0 ? '+' : ''}
      {k.changePct}% vs before
    </span>
  );
}

export function Kpis({ kpis }: { kpis: any[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <KpiTile
          key={k.label}
          title={k.note}
          label={k.label}
          value={
            <>
              {fmt(k.now)}
              {k.unit}
            </>
          }
        >
          <Change k={k} />
          <div className="mt-0.5 text-muted-foreground">{k.note || `Before: ${fmt(k.before)}${k.unit}`}</div>
        </KpiTile>
      ))}
    </div>
  );
}

// Weekly line chart. The dashed line marks where "this period" starts, so the left part of the
// graph is the previous period for comparison.
export function LineChart({ title, labels, series, splitAt }: { title: string; labels: string[]; series: { name: string; values: number[] }[]; splitAt: number }) {
  const config: ChartConfig = {};
  series.forEach((s, k) => {
    config[`s${k}`] = { label: s.name, color: COLORS[k % COLORS.length] };
  });
  const data = labels.map((l, i) => {
    const row: Record<string, any> = { label: l };
    series.forEach((s, k) => {
      row[`s${k}`] = s.values[i];
    });
    return row;
  });
  const showSplit = splitAt > 0 && splitAt < labels.length;
  return (
    <div className="mt-4 rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {/* PORT NOTE: the old SVG drew the dashed split half a week before labels[splitAt]; a
          category axis can only mark the week itself, so the line sits on the first week of this period. */}
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full" aria-label={title} role="img">
        <ReLineChart data={data} margin={{ left: 4, right: 12, top: 16 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={1} />
          <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => fmt(v)} domain={[0, (max: number) => Math.max(1, max)]} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => `Week of ${l}`} />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
          {showSplit && (
            <ReferenceLine
              x={labels[splitAt]}
              stroke="#D4AF37"
              strokeDasharray="4 4"
              label={{ value: 'this period', position: 'insideTopRight', fill: '#D4AF37', fontSize: 10 }}
            />
          )}
          {series.map((s, k) => (
            <Line key={s.name} dataKey={`s${k}`} name={s.name} type="linear" stroke={`var(--color-s${k})`} strokeWidth={2.5} dot={{ r: 3, fill: `var(--color-s${k})` }} isAnimationActive={false} />
          ))}
        </ReLineChart>
      </ChartContainer>
    </div>
  );
}

export function Table({ title, note, rows, cols, empty }: { title: ReactNode; note?: ReactNode; rows: any[] | null | undefined; cols: Col[]; empty?: ReactNode }) {
  return (
    <div className="mt-4 space-y-1.5">
      <SectionLabel>{title}</SectionLabel>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {rows && rows.length > 0 ? <DataTable rows={rows} cols={cols} /> : <p className="text-sm text-muted-foreground">{empty || 'None this period.'}</p>}
    </div>
  );
}

const shortUrl = (u: any) => String(u || '').replace(/^https?:\/\/(www\.)?usaindiacfo\.com/, '') || '/';
const pageLink = (r: any) => (
  <a href={r.page} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
    {shortUrl(r.page)}
  </a>
);

function SeoView({ p, split }: { p: any; split: number }) {
  const s = p.seo;
  return (
    <>
      <Kpis kpis={s.kpis} />
      <LineChart title="Google clicks per week" labels={s.series.labels} splitAt={split} series={[{ name: 'All clicks', values: s.series.clicks }, { name: 'Non-branded clicks', values: s.series.nonBrandedClicks }]} />
      <LineChart title="Organic visits per week (GA4)" labels={s.series.labels} splitAt={split} series={[{ name: 'Organic visits', values: s.series.organicVisits }]} />
      <LineChart title="Impressions per week" labels={s.series.labels} splitAt={split} series={[{ name: 'Impressions', values: s.series.impressions }]} />
      {s.tracked && (
        <Table
          title={`Tracked keywords (${s.tracked.total}) by Google position, today`}
          rows={[
            { band: 'Top 3', n: s.tracked.distribution.top3 },
            { band: 'Positions 4 to 10', n: s.tracked.distribution.top4to10 },
            { band: 'Positions 11 to 20', n: s.tracked.distribution.top11to20 },
            { band: 'Positions 21 to 100', n: s.tracked.distribution.top21to100 },
            { band: 'Not in the top 100', n: s.tracked.distribution.notRanked },
          ]}
          cols={[{ key: 'band', label: 'Position' }, { key: 'n', label: 'Keywords', muted: true }]}
        />
      )}
      <Table
        title="Pages losing the most clicks"
        rows={s.losers}
        cols={[
          { key: 'page', label: 'Page', render: pageLink },
          { key: 'before', label: 'Before', muted: true },
          { key: 'clicks', label: 'Now', muted: true },
          { key: 'change', label: 'Change', muted: true },
        ]}
      />
      <Table
        title="Pages gaining the most clicks"
        rows={s.gainers}
        cols={[
          { key: 'page', label: 'Page', render: pageLink },
          { key: 'before', label: 'Before', muted: true },
          { key: 'clicks', label: 'Now', muted: true },
          { key: 'change', label: 'Change', muted: true },
        ]}
      />
      {s.technical && (
        <p className="mt-3 text-sm text-muted-foreground">
          Latest site crawl ({String(s.technical.importedAt).slice(0, 10)}): {fmt(s.technical.urls)} URLs, {s.technical.broken} broken, {fmt(s.technical.missingTitles)} without a title, {fmt(s.technical.missingMeta)} without a meta description, {fmt(s.technical.thin)} thin pages.
        </p>
      )}
    </>
  );
}

function AeoView({ p, split }: { p: any; split: number }) {
  const a = p.aeo;
  return (
    <>
      <Kpis kpis={a.kpis} />
      <LineChart title="Clicks from question searches, per week" labels={a.series.labels} splitAt={split} series={[{ name: 'Clicks', values: a.series.questionClicks }]} />
      <LineChart title="Impressions on question searches, per week" labels={a.series.labels} splitAt={split} series={[{ name: 'Impressions', values: a.series.questionImpressions }]} />
      <Table
        title="Question searches we appear for"
        note="Position 1 to 3 on these is where featured snippets and AI answers usually come from."
        rows={a.topQuestions}
        cols={[
          { key: 'query', label: 'Search' },
          { key: 'impressions', label: 'Impressions', muted: true },
          { key: 'clicks', label: 'Clicks', muted: true },
          { key: 'position', label: 'Position', muted: true },
        ]}
      />
      {a.questionBank?.newQuestions?.length > 0 && (
        <Table
          title="New Google questions to answer in FAQs"
          rows={a.questionBank.newQuestions}
          cols={[{ key: 'question', label: 'Question' }, { key: 'keyword', label: 'Found for', muted: true }, { key: 'markets', label: 'Market', muted: true }]}
        />
      )}
      <p className="mt-3 text-sm text-muted-foreground">{a.notMeasurable}</p>
    </>
  );
}

function GeoView({ p, split }: { p: any; split: number }) {
  const g = p.geo;
  return (
    <>
      <Kpis kpis={g.kpis} />
      <LineChart title="Visits from AI assistants, per week" labels={g.series.labels} splitAt={split} series={[{ name: 'AI visits', values: g.series.aiVisits }, { name: 'Brand-name clicks', values: g.series.brandClicks }]} />
      <Table title="Where AI visits come from (this period)" rows={g.sources} empty="No visits from AI assistants this period." cols={[{ key: 'source', label: 'Source' }, { key: 'sessions', label: 'Visits', muted: true }]} />
      {g.overview?.rows?.length > 0 && (
        <Table
          title={`Google AI Overviews for priority keywords (checked ${String(g.overview.checkedAt).slice(0, 10)})`}
          rows={g.overview.rows}
          cols={[
            { key: 'keyword', label: 'Keyword' },
            { key: 'aiOverview', label: 'AI Overview', render: (r) => (r.aiOverview ? 'yes' : 'no') },
            { key: 'citesUs', label: 'Cites us', render: (r) => <StatusBadge kind={r.citesUs ? 'approved' : 'failed'}>{r.citesUs ? 'yes' : 'no'}</StatusBadge> },
          ]}
        />
      )}
      <p className="mt-3 text-sm text-muted-foreground">{g.notMeasurable}</p>
    </>
  );
}

// The paragraph at the end of each report: what improved and why, which block, what did not and
// why, and what is causing problems. Written by Claude from the report's own numbers.
function WhyItChanged({ view, days }: { view: string; days: number }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/performance/explain?view=${view}&days=${days}${fresh ? '&fresh=1' : ''}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
        setD(j);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [view, days]
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>Why it changed</CardTitle>
          <CardDescription>What improved and why, which block drove it, what did not improve, and what is causing problems. Based only on the numbers in this report.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
          Rewrite
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !d && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Reading the report and writing the explanation…</p>}
        {error && <p className="text-sm text-destructive">Error: {error}</p>}
        {d && <p className="text-sm leading-relaxed whitespace-pre-wrap">{d.text}</p>}
      </CardContent>
    </Card>
  );
}

export default function PerformanceTab({ view, onOpen }: { view: string; onOpen?: (v: string) => void }) {
  const [days, setDays] = useState(28);
  const canDownload = useRole().can('reports.download');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/performance?days=${days}${fresh ? '&fresh=1' : ''}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const p = data;
  const split = p ? p.seo.series.labels.length - Math.round(p.days / 7) : 0;
  const pillar = PILLARS[view];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>{view === 'overall' ? 'Overall report: SEO, AEO and GEO' : `${pillar.title} performance`}</CardTitle>
            <CardDescription>
              {view === 'overall'
                ? 'How the website is doing in classic search (SEO), answer engines (AEO) and generative AI (GEO), against the previous period.'
                : pillar.sub}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              <option value={28}>Last 28 days</option>
              <option value={56}>Last 56 days</option>
              <option value={90}>Last 90 days</option>
            </NativeSelect>
            <Button variant="outline" onClick={() => load(true)} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            {canDownload && (
            <a href={`/api/performance/download?days=${days}`} className={buttonVariants()}>
              <Download /> Download report (.docx)
            </a>
            )}
          </div>
        </CardHeader>
        {(p || error) && (
          <CardContent>
            {p && (
              <p className="text-sm text-muted-foreground">
                {p.ranges.current.startDate} to {p.ranges.current.endDate}, compared with {p.ranges.previous.startDate} to {p.ranges.previous.endDate}. The graph shows weeks, with the dashed line where this period starts.
              </p>
            )}
            {error && <p className="text-sm text-destructive">Error: {error}</p>}
            {p && Object.keys(p.errors || {}).length > 0 && (
              <Banner>Some sources could not be read: {Object.entries(p.errors).map(([k, v]) => `${k} (${String(v).slice(0, 100)})`).join('; ')}</Banner>
            )}
            {p && p.dataNotes.length > 0 && (
              <Banner>
                <strong>Read before reacting to a number:</strong>
                {p.dataNotes.map((n: any, i: number) => <div key={i}>{n}</div>)}
              </Banner>
            )}
          </CardContent>
        )}
      </Card>

      {!p && !error && (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Loading the numbers…</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      )}

      {p && view === 'overall' && (
        <>
          <BusinessResults days={days} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Overall
                <StatusBadge kind={STATUS[p.overall.status].badge}>{STATUS[p.overall.status].label}</StatusBadge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {p.overall.items.map((i: any) => (
                <div key={i.pillar} className="flex flex-col justify-between gap-3 rounded-xl border bg-muted/20 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{i.pillar}</div>
                      <StatusBadge kind={STATUS[i.status].badge}>{STATUS[i.status].label}</StatusBadge>
                    </div>
                    <div className="text-sm">{i.headline}</div>
                  </div>
                  <div>
                    <Button variant="outline" size="sm" onClick={() => onOpen?.(i.pillar.toLowerCase())}>Open {i.pillar}</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Key numbers</CardTitle>
            </CardHeader>
            <CardContent>
              <Kpis kpis={[p.seo.kpis[0], p.seo.kpis[1], p.seo.kpis[5], p.seo.kpis[6], p.aeo.kpis[0], p.geo.kpis[0]]} />
              <LineChart
                title="Clicks and visits per week"
                labels={p.seo.series.labels}
                splitAt={split}
                series={[
                  { name: 'Google clicks (SEO)', values: p.seo.series.clicks },
                  { name: 'Question clicks (AEO)', values: p.aeo.series.questionClicks },
                  { name: 'AI visits (GEO)', values: p.geo.series.aiVisits },
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}

      {p && view !== 'overall' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {pillar.title}
              <StatusBadge kind={STATUS[p[view].status].badge}>{STATUS[p[view].status].label}</StatusBadge>
            </CardTitle>
            <CardDescription className="text-foreground">{p[view].headline}</CardDescription>
          </CardHeader>
          <CardContent>
            {view === 'seo' && <SeoView p={p} split={split} />}
            {view === 'aeo' && <AeoView p={p} split={split} />}
            {view === 'geo' && <GeoView p={p} split={split} />}
          </CardContent>
        </Card>
      )}

      {p && <WhyItChanged key={`${view}-${days}`} view={view} days={days} />}
    </div>
  );
}

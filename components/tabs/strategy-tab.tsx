'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarRange, Check, Download, Loader2, Square, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { safeHref } from '@/components/shared/article';
import {
  Banner, Delta, KpiGrid, KpiTile, SectionLabel, SimpleTable, StatusBadge, statusBadgeClass,
} from '@/components/shared/ui-bits';

const Muted = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-sm text-muted-foreground ${className}`}>{children}</p>
);
const linkCls = 'text-primary underline-offset-4 hover:underline';

// The month-over-month numbers are computed in code (lib/monthlyMetrics.js), so these are exact.
export function StrategyMetrics({ mom, title, tilesOnly = false }: { mom: any; title?: string; tilesOnly?: boolean }) {
  if (!mom) return null;
  const gsc = mom.searchConsole;
  const ga = mom.ga4;
  const rk = mom.rankings;
  const tiles: any[] = [
    gsc && { label: 'Google clicks', now: gsc.totals.now.clicks, delta: <Delta value={gsc.totals.change.clicksPct} /> },
    gsc && { label: 'Impressions', now: gsc.totals.now.impressions.toLocaleString(), delta: <Delta value={gsc.totals.change.impressionsPct} /> },
    gsc && { label: 'Click-through rate', now: `${gsc.totals.now.ctr}%`, delta: <Delta value={gsc.totals.change.ctrPoints} suffix=" pts" /> },
    gsc && { label: 'Avg. position', now: gsc.totals.now.position, delta: <Delta value={gsc.totals.change.positionChange} suffix="" invert /> },
    ga && { label: 'Organic sessions', now: ga.organic.now.sessions, delta: <Delta value={ga.organic.sessionsPct} /> },
    ga && { label: 'Organic conversions', now: ga.organic.now.conversions, delta: <Delta value={ga.organic.conversionsPct} /> },
  ].filter(Boolean);

  const table = (title: string, rows: any[] | undefined, cols: { key: string; label: string; muted?: boolean }[]) =>
    rows && rows.length > 0 ? <SimpleTable title={title} rows={rows} cols={cols} /> : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title || "This period's numbers"}</CardTitle>
        {gsc && (
          <CardDescription>
            {gsc.ranges.current.startDate} to {gsc.ranges.current.endDate}, compared with {gsc.ranges.previous.startDate} to{' '}
            {gsc.ranges.previous.endDate}.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <KpiGrid>
          {tiles.map((t) => (
            <KpiTile key={t.label} label={t.label} value={t.now}>
              {t.delta} <span className="text-muted-foreground">vs previous</span>
            </KpiTile>
          ))}
          {rk?.distribution && (
            <KpiTile label="Tracked keywords in top 10" value={`${rk.distribution.top3 + rk.distribution.top4to10} / ${rk.trackedKeywords}`}>
              <span className="text-muted-foreground">{rk.distribution.notRanked} not in top 100</span>
            </KpiTile>
          )}
          {mom.contentShipped && (
            <KpiTile label="Content shipped (30 days)" value={mom.contentShipped.postsPublished}>
              <span className="text-muted-foreground">
                published, {mom.contentShipped.postsRefreshed} refreshed, {mom.contentShipped.draftsCreated} drafted
              </span>
            </KpiTile>
          )}
        </KpiGrid>
        {/* In the monthly report the diagnosis section replaces these lists with fuller versions. */}
        {!tilesOnly && (
          <>
            {table('Close to page one (positions 8 to 20): the fastest wins', gsc?.strikingDistance?.slice(0, 10), [
              { key: 'query', label: 'Query' },
              { key: 'position', label: 'Position', muted: true },
              { key: 'impressions', label: 'Impressions', muted: true },
              { key: 'clicks', label: 'Clicks', muted: true },
            ])}
            {table('On page one but rarely clicked: rewrite the title and meta description', gsc?.lowCtrOnPageOne?.slice(0, 8), [
              { key: 'query', label: 'Query' },
              { key: 'position', label: 'Position', muted: true },
              { key: 'impressions', label: 'Impressions', muted: true },
              { key: 'ctr', label: 'CTR %', muted: true },
            ])}
            {table('Pages losing the most clicks', gsc?.pageMovers?.losers?.slice(0, 8), [
              { key: 'key', label: 'Page' },
              { key: 'clicksBefore', label: 'Before', muted: true },
              { key: 'clicksNow', label: 'Now', muted: true },
              { key: 'clickChange', label: 'Change', muted: true },
            ])}
          </>
        )}
        {table('Search traffic that does not convert: add or fix the call to action', ga?.trafficButNoConversions?.slice(0, 8), [
          { key: 'page', label: 'Landing page' },
          { key: 'sessions', label: 'Sessions', muted: true },
          { key: 'conversions', label: 'Conversions', muted: true },
        ])}
        {Object.keys(mom.errors || {}).length > 0 && (
          <Muted className="mt-2.5">Unavailable: {Object.entries(mom.errors).map(([k, v]) => `${k} (${v})`).join('; ')}</Muted>
        )}
      </CardContent>
    </Card>
  );
}

const shortUrl = (u: any) => String(u || '').replace(/^https?:\/\/(www\.)?usaindiacfo\.com/, '') || '/';

// Analysis steps that can fail on their own (analysis.errors is keyed by these names).
const CHECK_LABELS: Record<string, string> = {
  searchConsoleBase: 'Search Console data',
  scoreboard: 'branded and non-branded clicks',
  decay: 'pages losing clicks',
  cohorts: 'results of past posts',
  regulatoryRefresh: 'Income-tax Act 2025 wording check',
  trackedKeywords: 'SE Ranking tracked keywords',
  aiVisibility: 'Google AI Overview check',
  aiReferrals: 'visits from AI assistants (GA4)',
};

const decayLabel = (type: any) => (type === 'lost' ? 'lost (no longer in Google results)' : String(type || '').replace(/_/g, ' '));
const BulletList = ({ items }: { items: any[] | undefined }) =>
  items && items.length ? (
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  ) : (
    <Muted>None this month.</Muted>
  );

function Section({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// The monthly report in the research's fixed section order. Numbers come from the stored analysis
// (computed in code); the picks' priority is computed in code from the inputs shown.
export function StrategyReport({ strategy, onUpdated }: { strategy: any; onUpdated: (json: any) => void }) {
  const report = strategy.report;
  const a = strategy.data_snapshot?.analysis || {};
  const nb = a.scoreboard?.nonBrandedClicks;
  const ai = a.aiVisibilitySummary;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAct = strategy.status === 'approved' || strategy.status === 'pending_review';

  // A failed step leaves its field empty, so its table must say so rather than "none found".
  const checkErrors = Object.entries(a.errors || {}).filter(([, v]) => v);
  const failed = (...steps: string[]) => {
    const hit = steps.find((s) => a.errors?.[s]);
    return hit ? `Could not check: ${String(a.errors[hit]).slice(0, 200)}` : null;
  };
  const aiRows: any[] = a.aiVisibility || [];
  const aiFailedCount = aiRows.filter((r) => r.error).length;

  async function act(index: any, action: string) {
    setBusy(`${index}:${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/strategy/${strategy.id}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdated(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function renderPick(p: any, label: ReactNode) {
    return (
      <div key={p.index} className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">
              {label}. {p.workingTitle || p.keyword}
            </div>
            <div className="text-sm text-muted-foreground">
              {p.keyword}
              {p.targetUrl && (
                <>
                  {' · '}
                  <a href={safeHref(p.targetUrl)} target="_blank" rel="noreferrer" className={linkCls}>{shortUrl(p.targetUrl)}</a>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-primary">{p.score.priority}</div>
            <div className="text-xs text-muted-foreground">priority</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge kind="gold">{p.action.replace('_', ' ')}</StatusBadge>
          {p.regulatory && <StatusBadge kind="failed">Income-tax Act 2025</StatusBadge>}
          {p.format && <StatusBadge kind="pending">{p.format}</StatusBadge>}
          {p.funnel && <StatusBadge kind="approved">{p.funnel}</StatusBadge>}
          {p.segment && <span className="text-xs text-muted-foreground">{p.segment}</span>}
        </div>
        <div className="mt-2 rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
          {p.score.trafficPotential} extra clicks in 12 months
          {p.score.trafficPotentialSource === 'estimate' ? ' (est.)' : ''} × value {p.score.businessValue} × deadline {p.score.deadlineFactor}
          {p.score.deadline ? ` (${p.score.deadline})` : ''} × confidence {p.score.confidence} ÷ effort {p.score.effort}
          {p.basis ? ` · ${p.basis}` : ''}
        </div>
        <p className="mt-2 mb-1 text-sm">{p.why}</p>
        {p.addsBeyondTop5 && <Muted className="my-1">Adds beyond the top results: {p.addsBeyondTop5}</Muted>}
        {p.faqQuestions.length > 0 && <Muted className="my-1">Suggested FAQ questions: {p.faqQuestions.join(' · ')}</Muted>}
        <div className="mt-2 flex">
          {p.action === 'new' ? (
            p.status?.keywordId ? (
              <StatusBadge kind="approved">In the blog pipeline</StatusBadge>
            ) : (
              <Button variant="outline" size="sm" disabled={!canAct || busy !== null} onClick={() => act(p.index, 'pipeline')}>
                {busy === `${p.index}:pipeline` && <Loader2 className="animate-spin" />}
                {busy === `${p.index}:pipeline` ? 'Adding…' : 'Add to blog pipeline'}
              </Button>
            )
          ) : p.targetUrl ? (
            p.status?.auditId ? (
              <StatusBadge kind="approved">Audit #{p.status.auditId} ready in Blog Audit</StatusBadge>
            ) : (
              <Button variant="outline" size="sm" disabled={!canAct || busy !== null} onClick={() => act(p.index, 'audit')}>
                {busy === `${p.index}:audit` && <Loader2 className="animate-spin" />}
                {busy === `${p.index}:audit` ? 'Auditing… (1-3 min)' : 'Audit this page'}
              </Button>
            )
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {checkErrors.length > 0 && (
        <Card className="ring-destructive/30">
          <CardContent>
            <p className="text-sm text-destructive">
              Some checks could not run:{' '}
              {checkErrors.map(([k, v]) => `${CHECK_LABELS[k] || k} (${String(v).slice(0, 160)})`).join('; ')}. The tables that
              depend on them say &quot;Could not check&quot; below, so an empty result there does not mean nothing was found.
            </p>
          </CardContent>
        </Card>
      )}

      <Section title="1. Data notes" description="Things that make some numbers misleading this month. Read these before reacting to any drop.">
        <BulletList items={[...(a.dataHygiene || []).map((e: any) => `${e.start}${e.end ? ` to ${e.end}` : ' onward'}: ${e.note}`), ...(report.dataNotes || [])]} />
      </Section>

      <StrategyMetrics mom={strategy.data_snapshot?.monthOverMonth} title="2. Scoreboard" tilesOnly />
      {(nb || ai || a.aiReferrals || failed('scoreboard', 'aiReferrals', 'aiVisibility')) && (
        <Section
          title="Search that is not your brand name"
          description="Branded searches (people typing USAIndiaCFO) mostly reflect existing demand. Growth from SEO shows up here."
        >
          <KpiGrid>
            {nb && (
              <>
                <KpiTile label="Non-branded clicks, US" value={nb.now.US}>
                  <Delta value={nb.changePct.US} /> <span className="text-muted-foreground">vs previous</span>
                </KpiTile>
                <KpiTile label="Non-branded clicks, India" value={nb.now.India}>
                  <Delta value={nb.changePct.India} /> <span className="text-muted-foreground">vs previous</span>
                </KpiTile>
                <KpiTile label="Branded clicks" value={a.scoreboard.brandedClicks.now}>
                  <span className="text-muted-foreground">was {a.scoreboard.brandedClicks.before}</span>
                </KpiTile>
              </>
            )}
            {a.aiReferrals && (
              <KpiTile label="Visits from AI assistants" value={a.aiReferrals.now.sessions}>
                <Delta value={a.aiReferrals.changePct} /> <span className="text-muted-foreground">vs previous</span>
              </KpiTile>
            )}
            {ai && (
              <KpiTile label="Google AI Overviews citing us" value={`${ai.citingUs} / ${ai.withAiOverview}`}>
                <span className="text-muted-foreground">
                  {ai.checked} priority keywords checked{aiFailedCount > 0 ? `, ${aiFailedCount} more failed` : ''}
                </span>
              </KpiTile>
            )}
          </KpiGrid>
          <div className="mt-2 space-y-1">
            {failed('scoreboard') && <Muted>Branded and non-branded clicks. {failed('scoreboard')}</Muted>}
            {failed('aiReferrals') && <Muted>Visits from AI assistants. {failed('aiReferrals')}</Muted>}
            {failed('aiVisibility') && <Muted>Google AI Overviews. {failed('aiVisibility')}</Muted>}
          </div>
          <BulletList items={report.scoreboardNotes} />
        </Section>
      )}

      <Section
        title="3. Results of past work"
        description="Posts published about 1, 3 and 6 months ago and what they earn now. Not in the top 10 by 6 months means it goes back into the plan."
      >
        {failed('cohorts') && <Muted>{failed('cohorts')}</Muted>}
        {!failed('cohorts') && failed('searchConsoleBase') && (
          <Muted>Clicks and positions below are missing because Search Console could not be read. {failed('searchConsoleBase')}</Muted>
        )}
        {(a.cohorts || []).map((c: any) => (
          <SimpleTable
            key={c.label}
            title={`Published ${c.label}`}
            rows={c.posts}
            empty="No posts published in this window."
            cols={[
              { key: 'title', label: 'Post', render: (p) => <a href={p.url} target="_blank" rel="noreferrer" className={linkCls}>{p.title}</a> },
              { key: 'published', label: 'Published', muted: true },
              { key: 'clicks28d', label: 'Clicks (28d)', muted: true },
              { key: 'position', label: 'Position', muted: true, render: (p) => p.position ?? 'not ranking' },
              { key: 'onTrack', label: 'On track', render: (p) => <StatusBadge kind={p.onTrack ? 'approved' : 'failed'}>{p.onTrack ? 'yes' : 'no'}</StatusBadge> },
            ]}
          />
        ))}
      </Section>

      <Section title="4. Diagnosis">
        <BulletList items={report.diagnosis} />
        <SimpleTable
          title="Pages losing clicks, by cause"
          note="Ranking decay: upgrade the content. Zero-click: the AI answer took the click, so sharpen the answer and title. Demand decay: fewer people searching, time it to the next deadline. Lost: the page no longer shows in Google results, so check it still exists, is indexed and is not redirected."
          rows={a.decay}
          empty={failed('decay') || 'No pages lost clicks this period.'}
          cols={[
            { key: 'page', label: 'Page', render: (d) => <a href={safeHref(d.page)} target="_blank" rel="noreferrer" className={linkCls}>{shortUrl(d.page)}</a> },
            { key: 'type', label: 'Cause', render: (d) => decayLabel(d.type) },
            { key: 'clicks', label: 'Clicks', muted: true, render: (d) => `${d.clicksBefore} → ${d.clicksNow ?? 0}` },
            { key: 'position', label: 'Position', muted: true, render: (d) => `${d.positionBefore} → ${d.positionNow ?? 'not in results'}` },
          ]}
        />
        <SimpleTable
          title="Close to the top: click problems (positions 4 to 10)"
          note="Fix the title, meta description and the direct answer near the top."
          rows={a.strikingDistance?.clickProblems}
          empty={failed('searchConsoleBase') || 'None with enough searches this period.'}
          cols={[
            { key: 'query', label: 'Query' },
            { key: 'page', label: 'Page', render: (s) => shortUrl(s.page) },
            { key: 'position', label: 'Position', muted: true },
            { key: 'potentialExtraClicks', label: 'Extra clicks at #3 / 28d', muted: true },
          ]}
        />
        <SimpleTable
          title="Close to page one: ranking problems (positions 11 to 20)"
          note="Add depth and sub-questions, internal links from related posts, and fresher facts."
          rows={a.strikingDistance?.rankingProblems}
          empty={failed('searchConsoleBase') || 'None with enough searches this period.'}
          cols={[
            { key: 'query', label: 'Query' },
            { key: 'page', label: 'Page', render: (s) => shortUrl(s.page) },
            { key: 'position', label: 'Position', muted: true },
            { key: 'potentialExtraClicks', label: 'Extra clicks at #3 / 28d', muted: true },
          ]}
        />
        <SimpleTable
          title="Our pages competing for the same search"
          note="If they answer the same question, merge into the stronger page and redirect the other. Never fix this with noindex or deletion."
          rows={a.cannibalization}
          empty={failed('searchConsoleBase') || 'No competing pages found.'}
          cols={[
            { key: 'query', label: 'Query' },
            { key: 'pages', label: 'Pages (share, position)', render: (c) => c.pages.map((p: any) => `${shortUrl(p.page)} (${p.share}%, #${p.position})`).join('; ') },
          ]}
        />
        <SimpleTable
          title="Posts to update for India's Income-tax Act 2025"
          note="These still use Assessment Year or 1961 Act wording. Highest traffic first."
          rows={a.regulatoryRefresh}
          empty={failed('regulatoryRefresh') || 'None found.'}
          cols={[
            { key: 'title', label: 'Post', render: (r) => <a href={r.url} target="_blank" rel="noreferrer" className={linkCls}>{r.title}</a> },
            { key: 'example', label: 'Still says', muted: true },
            { key: 'clicks28d', label: 'Clicks (28d)', muted: true },
          ]}
        />
      </Section>

      <Section
        title={<>5. This month&apos;s picks</>}
        description={
          <>
            Priority = Extra clicks over 12 months × Business value × Deadline factor × Confidence ÷ Effort, calculated in code. &quot;est.&quot;
            means the click figure is an estimate for a new topic, not from your data. New articles go into the blog pipeline with their brief;
            existing pages get a full audit, then use Rewrite in the Blog Audit tab.
          </>
        }
      >
        {report.planChecks?.length > 0 && (
          <Banner className="mt-0 mb-3">
            {report.planChecks.map((c: any, i: number) => (
              <div key={i}>{c}</div>
            ))}
          </Banner>
        )}
        {error && <p className="mb-2 text-sm text-destructive">Error: {error}</p>}
        <div className="grid gap-3 lg:grid-cols-2">{report.picks.map((p: any, i: number) => renderPick(p, i + 1))}</div>
      </Section>

      {report.quickEdits?.length > 0 && (
        <Section
          title="Quick-edit track (outside the 8 slots)"
          description="One-hour fixes: title, meta description, the answer at the top, FAQ additions and Income-tax Act transition notes. Audit the page, then apply the small changes in the rewrite or ask the Assistant to make them."
        >
          <div className="grid gap-3 lg:grid-cols-2">{report.quickEdits.map((p: any, i: number) => renderPick(p, `Q${i + 1}`))}</div>
        </Section>
      )}

      {(report.quickWins?.length > 0 || report.nextInLine?.length > 0) && (
        <Card>
          <CardContent>
            {report.quickWins?.length > 0 && (
              <>
                <h3 className="font-heading text-base font-medium">Other quick wins</h3>
                <BulletList items={report.quickWins} />
              </>
            )}
            {report.nextInLine?.length > 0 && (
              <SimpleTable
                title="Next in line (scored lower this month)"
                rows={report.nextInLine}
                cols={[
                  { key: 'title', label: 'Pick', render: (p) => p.workingTitle || p.keyword },
                  { key: 'action', label: 'Action', muted: true },
                  { key: 'priority', label: 'Priority', muted: true, render: (p) => p.score.priority },
                ]}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Section title="6. Merge and redirect decisions">
        <SimpleTable
          title="Consolidation"
          rows={report.consolidation}
          empty="No merges needed this month."
          cols={[
            { key: 'query', label: 'Query' },
            { key: 'keepUrl', label: 'Keep', render: (c) => shortUrl(c.keepUrl) },
            { key: 'mergeUrl', label: 'Merge and 301', render: (c) => shortUrl(c.mergeUrl) },
            { key: 'reason', label: 'Why', muted: true },
          ]}
        />
      </Section>

      <Section title="7. Technical fixes">
        <SimpleTable
          title="Top fixes by impact and effort"
          rows={report.technical}
          empty="No material technical issues found."
          cols={[
            { key: 'fix', label: 'Fix' },
            { key: 'impact', label: 'Impact', muted: true },
            { key: 'effort', label: 'Effort', muted: true },
            { key: 'evidence', label: 'Evidence', muted: true },
          ]}
        />
      </Section>

      <Section title="8. AI search (GEO) and authority">
        <SimpleTable
          title="Google AI Overviews for priority keywords (US, live)"
          note={aiFailedCount > 0 ? `${aiFailedCount} of ${aiRows.length} keyword checks failed (timed out or errored) and are not shown.` : undefined}
          rows={aiRows.filter((r) => !r.error)}
          empty={
            failed('aiVisibility') ||
            (aiFailedCount > 0 ? `Could not check: all ${aiFailedCount} keyword checks failed (timed out or errored).` : 'The AI Overview check did not run this time.')
          }
          cols={[
            { key: 'keyword', label: 'Keyword' },
            { key: 'aiOverview', label: 'AI Overview', render: (r) => (r.aiOverview ? 'yes' : 'no') },
            { key: 'citesUs', label: 'Cites us', render: (r) => <StatusBadge kind={r.citesUs ? 'approved' : 'failed'}>{r.citesUs ? 'yes' : 'no'}</StatusBadge> },
            { key: 'organicPosition', label: 'Our position', muted: true, render: (r) => r.organicPosition ?? 'not in top results' },
            { key: 'citedSites', label: 'Sites it cites', muted: true, render: (r) => r.citedSites.join(', ') },
          ]}
        />
        {a.aiReferrals?.now?.sessions > 0 && (
          <SimpleTable
            title="Visits from AI assistants (last 28 days, GA4)"
            rows={Object.entries(a.aiReferrals.now.bySource).map(([source, v]: [string, any]) => ({ source, ...v }))}
            cols={[
              { key: 'source', label: 'Source' },
              { key: 'sessions', label: 'Sessions', muted: true },
              { key: 'conversions', label: 'Conversions', muted: true },
            ]}
          />
        )}
        {a.questionBank && (
          <SimpleTable
            title={`New Google "People also ask" questions this month (${a.questionBank.newCount} new, ${a.questionBank.total} in the question bank)`}
            note={'Questions searchers are asking, counted as new once Google has shown them twice' + (a.questionBank.unconfirmedCount ? ' (' + a.questionBank.unconfirmedCount + ' more seen once so far)' : '') + '. Answer the ones that fit in the FAQ of the page that covers the topic.'}
            rows={a.questionBank.newQuestions}
            empty="No new questions this month."
            cols={[
              { key: 'question', label: 'Question' },
              { key: 'keyword', label: 'Found for', muted: true },
              { key: 'markets', label: 'Market', muted: true },
            ]}
          />
        )}
        <SectionLabel className="mt-4">AI search actions</SectionLabel>
        <BulletList items={report.geo} />
        <SectionLabel className="mt-4">Authority (earned mentions, never bought links)</SectionLabel>
        <BulletList items={report.authority} />
        <SimpleTable
          title="Who you compete with in search"
          rows={report.competitors}
          cols={[
            { key: 'domain', label: 'Site' },
            { key: 'whatWorks', label: 'What works for them', muted: true },
            { key: 'gap', label: 'Opening for us' },
          ]}
        />
      </Section>

      <Section title="9. Risks and open questions">
        <BulletList items={report.risks} />
        {report.measurementGaps?.length > 0 && (
          <>
            <SectionLabel className="mt-4">What cannot be measured yet, and the one-time fix</SectionLabel>
            <BulletList items={report.measurementGaps} />
          </>
        )}
        <SimpleTable
          title="Upcoming deadlines that drive searches (confirm dates on the official calendar)"
          rows={a.deadlines}
          cols={[
            { key: 'date', label: 'Date' },
            { key: 'market', label: 'Market', muted: true },
            { key: 'what', label: 'Deadline' },
            { key: 'daysAway', label: 'Days away', muted: true },
          ]}
        />
      </Section>
    </>
  );
}

const fetchDueInfo = () =>
  fetch('/api/strategy/auto-check')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const clockTime = (iso: any) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
};

const LIST_FIELDS = ['keyword_priorities', 'content_recommendations', 'technical_recommendations', 'competitor_notes'];

// Stays mounted (hidden) while other tabs are open; `active` says whether it is the visible tab.
export default function StrategyTab({ active: isVisible = true }: { active?: boolean }) {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<any>(null); // { stage, percent, since }
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  const [due, setDue] = useState<any>(null); // { period, due, existingId, running, runningSince }
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const [list, dueInfo] = await Promise.all([
      fetch('/api/strategy').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetchDueInfo(),
    ]);
    setStrategies(Array.isArray(list) ? list : []);
    setDue(dueInfo);
    return list;
  }, []);

  useEffect(() => {
    fetch('/api/strategy/metrics')
      .then((r) => r.json())
      .then(setLiveMetrics)
      .catch(() => {});
  }, []);

  // Reload the list each time the tab is shown (it used to remount on every visit).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isVisible) load();
  }, [isVisible, load]);

  // A run started somewhere else (another browser tab, the monthly auto-run): check every 30
  // seconds and show the new plan once it is saved.
  const runningElsewhere = !generating && Boolean(due?.running);
  useEffect(() => {
    if (!runningElsewhere) return undefined;
    const t = setInterval(async () => {
      const info = await fetchDueInfo();
      if (!info) return;
      if (info.running) setDue(info);
      else load();
    }, 30000);
    return () => clearInterval(t);
  }, [runningElsewhere, load]);

  // Opening a strategy copies it into the edit form. A reload of the same strategy (after a pick
  // action, approval or revisiting the tab) takes the new server data but keeps unsaved typing.
  useEffect(() => {
    const s = strategies.find((x) => x.id === openId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing((prev: any) => {
      if (!s) return null;
      if (!prev || prev.id !== s.id) return { ...s };
      const kept: any = { summary: prev.summary };
      if (!s.report) {
        for (const f of LIST_FIELDS) kept[f] = prev[f];
      }
      return { ...s, ...kept };
    });
  }, [openId, strategies]);

  useEffect(() => {
    if (!generating) return undefined;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [generating]);

  async function generate() {
    setGenerating(true);
    setElapsed(0);
    setMessage(null);
    setProgress({ stage: 'Starting…', percent: 2 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
      if (!res.ok) {
        // 409: another run holds the lock. Say so; the finally block refreshes the running banner.
        const json = await res.json().catch(() => null);
        if (res.status === 409) {
          setMessage(json?.error || 'A strategy is already being generated.');
          return;
        }
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() as string;
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.stage || evt.percent != null) setProgress({ stage: evt.stage, percent: evt.percent });
          if (evt.status === 'done') {
            await load();
            setOpenId(evt.result.id);
            setMessage('The plan is ready below. Review it, then approve it to make it the active strategy.');
          } else if (evt.status === 'stopped') setMessage('Stopped. Nothing was saved.');
          else if (evt.status === 'error') setMessage('Error: ' + evt.error);
        }
      }
    } catch (err: any) {
      setMessage(err.name === 'AbortError' ? 'Stopped. Nothing was saved.' : 'Error: ' + err.message);
    } finally {
      setGenerating(false);
      setProgress(null);
      abortRef.current = null;
      // The stream has ended, so the server has released its lock (or another run holds it).
      fetchDueInfo().then((info) => info && setDue(info));
    }
  }

  async function saveEdits(status: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/strategy/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing.report
            ? { summary: editing.summary, status }
            : {
                summary: editing.summary,
                keyword_priorities: editing.keyword_priorities,
                content_recommendations: editing.content_recommendations,
                technical_recommendations: editing.technical_recommendations,
                competitor_notes: editing.competitor_notes,
                status,
              }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await load();
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteStrategy() {
    if (!window.confirm(`Delete the ${editing.period} strategy${editing.status === 'approved' ? ' (currently approved)' : ''}? Keywords it added that are not written yet will be removed too. Drafts already written are kept.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/strategy/${editing.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditing(null);
      setMessage(`Strategy deleted${json.removedKeywords ? `, ${json.removedKeywords} unwritten keyword(s) removed` : ''}. You can generate a new one now.`);
      await load();
      fetchDueInfo().then((info) => info && setDue(info));
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function updateListField(field: string, index: number, value: string) {
    setEditing((prev: any) => {
      const next = [...prev[field]];
      next[index] = value;
      return { ...prev, [field]: next };
    });
  }

  // A row with status 'generating' only marks a run in progress; it is not a plan to open.
  const listed = strategies.filter((s) => s.status !== 'generating');
  const active = listed.find((s) => s.status === 'approved');
  const minutes = `${Math.floor(elapsed / 60)} min ${elapsed % 60} s`;
  const runningSince = clockTime(due?.runningSince);

  const listInputs = (field: string, label: string) => (
    <div className="space-y-1">
      <SectionLabel>{label}</SectionLabel>
      {editing[field].map((k: string, i: number) => (
        <Input key={i} type="text" value={k} onChange={(e) => updateListField(field, i, e.target.value)} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="size-4 text-muted-foreground" />
            Monthly SEO and GEO strategy
          </CardTitle>
          <CardDescription>
            Each month the dashboard checks your data (Search Console, GA4, SE Ranking, live Google results and AI Overviews, WordPress, the
            crawl), finds what is decaying, close to the top, competing with itself or out of date under the new Income-tax Act, researches
            competitors, and proposes 8 scored picks. Nothing changes until you approve. The approved plan guides every new draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {runningElsewhere ? (
            <Banner className="mt-0">
              A plan is being generated{runningSince ? ` (started ${runningSince})` : ''}. It appears here when done.
            </Banner>
          ) : (
            due?.due &&
            !generating && (
              <Banner className="mt-0">
                The {due.period} plan has not been made yet. Generate it now, or it runs automatically once the monthly schedule is set up.
              </Banner>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate} disabled={generating || runningElsewhere}>
              {(generating || runningElsewhere) && <Loader2 className="animate-spin" />}
              {generating || runningElsewhere ? 'Working…' : `Generate the ${due?.period || 'monthly'} strategy`}
            </Button>
            {generating && (
              <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
                <Square /> Stop
              </Button>
            )}
          </div>
          {generating && progress && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
              <Muted>
                {progress.stage} ({minutes} so far; the whole run usually takes 10 to 20 minutes; you can use the other tabs meanwhile)
              </Muted>
            </div>
          )}
          {message && <Muted>{message}</Muted>}
          {active && (
            <Muted>
              Active strategy: <strong className="text-foreground">{active.period}</strong> (approved {active.decided_at})
            </Muted>
          )}
        </CardContent>
      </Card>

      {!editing &&
        (liveMetrics ? (
          <StrategyMetrics mom={liveMetrics} />
        ) : (
          <Card>
            <CardContent className="space-y-3">
              <Muted>Loading this period&apos;s numbers…</Muted>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
            </CardContent>
          </Card>
        ))}

      <Card>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.map((s) => (
                  <TableRow key={s.id} data-state={s.id === openId ? 'selected' : undefined}>
                    <TableCell className="font-medium">{s.period}</TableCell>
                    <TableCell>
                      <StatusBadge kind={statusBadgeClass(s.status)}>{s.status.replace('_', ' ')}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.created_at}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setOpenId(s.id)}>Open</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {listed.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">No strategy generated yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editing.period}
              <StatusBadge kind={statusBadgeClass(editing.status)}>{editing.status.replace('_', ' ')}</StatusBadge>
            </CardTitle>
            <CardAction className="flex flex-wrap gap-2">
              <a href={`/api/strategy/${editing.id}/download`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Download /> Download report (.docx)
              </a>
              <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                <X /> Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="space-y-1">
              <SectionLabel>Summary (editable)</SectionLabel>
              <Textarea rows={4} value={editing.summary || ''} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
            </div>

            {!editing.report && (
              <>
                {listInputs('keyword_priorities', 'Keyword priorities')}
                {listInputs('content_recommendations', 'Content recommendations')}
                {listInputs('technical_recommendations', 'Technical recommendations')}
                <div className="space-y-1">
                  <SectionLabel>Competitor notes</SectionLabel>
                  <Textarea rows={4} value={editing.competitor_notes || ''} onChange={(e) => setEditing({ ...editing, competitor_notes: e.target.value })} />
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => saveEdits(null)} disabled={saving}>
                Save summary
              </Button>
              {editing.status !== 'approved' && (
                <>
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-600/85" onClick={() => saveEdits('approved')} disabled={saving}>
                    <Check /> Approve as active strategy
                  </Button>
                  <Button variant="destructive" onClick={() => saveEdits('rejected')} disabled={saving}>
                    Reject
                  </Button>
                </>
              )}
              <Button variant="outline" className="text-red-600 dark:text-red-400" onClick={deleteStrategy} disabled={saving}>
                Delete strategy
              </Button>
            </div>

            {Object.keys(editing.data_snapshot || {}).some((k) => k.endsWith('Error')) && (
              <Muted>
                Some sources were unavailable when this was generated:{' '}
                {Object.entries(editing.data_snapshot)
                  .filter(([k]) => k.endsWith('Error'))
                  .map(([k, v]) => `${k.replace('Error', '')} (${String(v).slice(0, 120)})`)
                  .join('; ')}
              </Muted>
            )}
          </CardContent>
        </Card>
      )}

      {editing && editing.report && <StrategyReport key={editing.id} strategy={editing} onUpdated={() => load()} />}
      {editing && !editing.report && <StrategyMetrics mom={editing.data_snapshot?.monthOverMonth} />}
    </div>
  );
}

'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  BarChart3, Building2, ClipboardCopy, ExternalLink, Gauge, Globe, Loader2, MousePointerClick, PlugZap,
  RefreshCw, Search, Spline, Upload, Wand2,
} from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TONE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
};

function Pill({ tone = 'success', children }: { tone?: 'success' | 'warn' | 'danger'; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={TONE[tone]}>
      {children}
    </Badge>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-sm break-words">{children}</p>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border">
      <Table>{children}</Table>
    </div>
  );
}

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="animate-spin" /> : null;
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">{children}</div>
    </section>
  );
}

type ConnState = 'checking' | 'ok' | 'off' | 'fail' | undefined;

// Green / amber / red status shown in the top-right of each connector card.
function ConnBadge({ state }: { state: ConnState }) {
  if (!state) return null;
  if (state === 'checking') return <Pill tone="warn"><Loader2 className="size-3 animate-spin" /> Checking</Pill>;
  if (state === 'ok') return <Pill tone="success">● Connected</Pill>;
  if (state === 'off') return <Pill tone="warn">● Not connected</Pill>;
  return <Pill tone="danger">● Error</Pill>;
}

const CONN_TESTS = ['wordpress', 'gsc', 'gbp', 'zoho', 'seranking', 'surfer', 'serphouse'] as const;

function ConnCard({
  icon: Icon, title, description, badge, className, children,
}: {
  icon: any; title: React.ReactNode; description: React.ReactNode; badge?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {badge && <CardAction>{badge}</CardAction>}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">{children}</CardContent>
    </Card>
  );
}

function YoastFieldsCard() {
  const [state, setState] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  async function check() {
    setState({ checking: true });
    try {
      const res = await fetch('/api/wordpress/yoast-status');
      setState(await res.json());
    } catch (e: any) {
      setState({ error: e.message });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(state.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ConnCard
      icon={Wand2}
      title="Yoast SEO fields"
      badge={
        state && !state.checking ? (
          <Pill tone={state.installed ? 'success' : 'warn'}>{state.installed ? 'connected' : 'one-time setup needed'}</Pill>
        ) : undefined
      }
      description={
        <>
          Lets the dashboard and the assistant write each post&apos;s Yoast meta description and focus keyphrase. Until
          this is set up, published blogs go live without a meta description (Google then picks random text from the page).
        </>
      }
    >
      {state && !state.checking && !state.installed && (
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm leading-relaxed">
          <li>In WordPress admin, install and activate the free &quot;Code Snippets&quot; plugin (or ask the assistant to install it).</li>
          <li>Go to Snippets &gt; Add New, give it a name like &quot;Growth Center Yoast fields&quot;.</li>
          <li>Paste the snippet below (everything after the first line), choose &quot;Run snippet everywhere&quot;, then Save and Activate.</li>
          <li>Come back here and click Check again.</li>
        </ol>
      )}
      <Actions>
        <Button onClick={check} disabled={state?.checking}>
          {state?.checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {state?.checking ? 'Checking…' : 'Check again'}
        </Button>
        {state?.snippet && (
          <Button variant="outline" onClick={copy}>
            <ClipboardCopy /> {copied ? 'Copied' : 'Copy snippet'}
          </Button>
        )}
      </Actions>
      {state?.error && <Status>Could not check: {state.error}</Status>}
      {state?.snippet && !state.installed && (
        <pre className="bg-muted/50 max-h-80 overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{state.snippet}</pre>
      )}
    </ConnCard>
  );
}

export default function SettingsTab() {
  const [status, setStatus] = useState<string | null>(null);

  // Connection status for each connector, checked automatically when Settings opens.
  const [conn, setConn] = useState<Record<string, ConnState>>(() => Object.fromEntries(CONN_TESTS.map((n) => [n, 'checking'])));
  const markConn = (name: string, json: any) =>
    setConn((c) => ({ ...c, [name]: json?.ok ? 'ok' : json?.connected === false ? 'off' : 'fail' }));
  useEffect(() => {
    let alive = true;
    for (const name of CONN_TESTS) {
      fetch(`/api/${name}/test`)
        .then((r) => r.json())
        .then((json) => alive && markConn(name, json))
        .catch(() => alive && setConn((c) => ({ ...c, [name]: 'fail' })));
    }
    return () => {
      alive = false;
    };
  }, []);

  const [gscStatus, setGscStatus] = useState<string | null>(null);
  const [queries, setQueries] = useState<any[] | null>(null);
  const [loadingQueries, setLoadingQueries] = useState(false);

  const [pageSpeedUrl, setPageSpeedUrl] = useState('https://usaindiacfo.com/');
  const [pageSpeedResult, setPageSpeedResult] = useState<any>(null);
  const [loadingPageSpeed, setLoadingPageSpeed] = useState(false);
  const [pageSpeedError, setPageSpeedError] = useState<string | null>(null);

  const [ga4Summary, setGa4Summary] = useState<any>(null);
  const [ga4Pages, setGa4Pages] = useState<any[] | null>(null);
  const [loadingGa4, setLoadingGa4] = useState(false);
  const [ga4Error, setGa4Error] = useState<string | null>(null);

  const [clarityData, setClarityData] = useState<any>(null);
  const [loadingClarity, setLoadingClarity] = useState(false);
  const [clarityError, setClarityError] = useState<string | null>(null);

  const [gbpStatus, setGbpStatus] = useState<string | null>(null);

  const [zohoStatus, setZohoStatus] = useState<string | null>(null);
  const [zohoPipeline, setZohoPipeline] = useState<any>(null);
  const [zohoLeads, setZohoLeads] = useState<any>(null);
  const [loadingZohoLeads, setLoadingZohoLeads] = useState(false);
  const [loadingZoho, setLoadingZoho] = useState(false);

  const [seRankingStatus, setSeRankingStatus] = useState<string | null>(null);
  const [seRankings, setSeRankings] = useState<any[] | null>(null);
  const [loadingSeRanking, setLoadingSeRanking] = useState(false);

  const [crawls, setCrawls] = useState<any[] | null>(null);
  const [loadingCrawls, setLoadingCrawls] = useState(false);
  const [uploadingCrawl, setUploadingCrawl] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState<string | null>(null);
  const [expandedCrawlId, setExpandedCrawlId] = useState<any>(null);
  const crawlInputRef = useRef<HTMLInputElement>(null);

  const [serphouseStatus, setSerphouseStatus] = useState<string | null>(null);
  const [serphouseKeyword, setSerphouseKeyword] = useState('');
  const [serphouseResult, setSerphouseResult] = useState<any>(null);
  const [loadingSerphouse, setLoadingSerphouse] = useState(false);

  const [surferStatus, setSurferStatus] = useState<string | null>(null);
  const [surferKeyword, setSurferKeyword] = useState('');
  const [surferTerms, setSurferTerms] = useState<any[] | null>(null);
  const [loadingSurfer, setLoadingSurfer] = useState(false);

  async function test() {
    setStatus('Testing…');
    try {
      const res = await fetch('/api/wordpress/test');
      const json = await res.json();
      markConn('wordpress', json);
      setStatus(json.ok ? `Connected as ${json.connectedAs}` : `Failed: ${json.error}`);
    } catch (err: any) {
      setStatus('Failed: ' + err.message);
    }
  }

  async function testGsc() {
    setGscStatus('Testing…');
    try {
      const res = await fetch('/api/gsc/test');
      const json = await res.json();
      markConn('gsc', json);
      setGscStatus(
        json.ok
          ? `Connected, property: ${json.sites.map((s: any) => s.url).join(', ')}`
          : `Failed: ${json.error}`
      );
    } catch (err: any) {
      setGscStatus('Failed: ' + err.message);
    }
  }

  async function loadQueries() {
    setLoadingQueries(true);
    try {
      const res = await fetch('/api/gsc/top-queries');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setQueries(json);
    } catch (err: any) {
      setGscStatus('Failed: ' + err.message);
    } finally {
      setLoadingQueries(false);
    }
  }

  async function checkPageSpeed(strategy: string) {
    setLoadingPageSpeed(true);
    setPageSpeedError(null);
    try {
      const res = await fetch(
        `/api/pagespeed/check?url=${encodeURIComponent(pageSpeedUrl)}&strategy=${strategy}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPageSpeedResult(json);
    } catch (err: any) {
      setPageSpeedError(err.message);
    } finally {
      setLoadingPageSpeed(false);
    }
  }

  async function loadGa4() {
    setLoadingGa4(true);
    setGa4Error(null);
    try {
      const [summaryRes, pagesRes] = await Promise.all([
        fetch('/api/ga4/summary'),
        fetch('/api/ga4/top-pages'),
      ]);
      const summary = await summaryRes.json();
      const pages = await pagesRes.json();
      if (!summaryRes.ok) throw new Error(summary.error);
      if (!pagesRes.ok) throw new Error(pages.error);
      setGa4Summary(summary);
      setGa4Pages(pages);
    } catch (err: any) {
      setGa4Error(err.message);
    } finally {
      setLoadingGa4(false);
    }
  }

  async function loadClarity() {
    setLoadingClarity(true);
    setClarityError(null);
    try {
      const res = await fetch('/api/clarity/insights?numOfDays=3');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const byName: Record<string, any> = {};
      for (const m of json) byName[m.metricName] = m.information?.[0] || {};
      setClarityData(byName);
    } catch (err: any) {
      setClarityError(err.message);
    } finally {
      setLoadingClarity(false);
    }
  }

  async function testGbp() {
    setGbpStatus('Testing…');
    try {
      const res = await fetch('/api/gbp/test');
      const json = await res.json();
      markConn('gbp', json);
      if (!json.connected) {
        setGbpStatus('Not connected yet. Click "Connect" below.');
      } else if (!json.ok) {
        setGbpStatus(`Failed: ${json.error}`);
      } else {
        const locCount = json.accounts.reduce((sum: number, a: any) => sum + a.locations.length, 0);
        setGbpStatus(`Connected: ${json.accounts.length} account(s), ${locCount} location(s).`);
      }
    } catch (err: any) {
      setGbpStatus('Failed: ' + err.message);
    }
  }

  async function testZoho() {
    setZohoStatus('Testing…');
    try {
      const res = await fetch('/api/zoho/test');
      const json = await res.json();
      markConn('zoho', json);
      if (!json.connected) {
        setZohoStatus('Not connected yet. Click "Connect" below.');
      } else if (!json.ok) {
        setZohoStatus(`Failed: ${json.error}`);
      } else {
        setZohoStatus(`Connected: ${json.orgName || 'org confirmed'}.`);
      }
    } catch (err: any) {
      setZohoStatus('Failed: ' + err.message);
    }
  }

  async function loadZohoPipeline() {
    setLoadingZoho(true);
    try {
      const res = await fetch('/api/zoho/pipeline');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setZohoPipeline(json);
    } catch (err: any) {
      setZohoStatus('Failed: ' + err.message);
    } finally {
      setLoadingZoho(false);
    }
  }

  async function loadZohoLeads() {
    setLoadingZohoLeads(true);
    try {
      const res = await fetch('/api/zoho/leads');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setZohoLeads(json);
    } catch (err: any) {
      setZohoStatus('Failed: ' + err.message);
    } finally {
      setLoadingZohoLeads(false);
    }
  }

  async function testSeRanking() {
    setSeRankingStatus('Testing…');
    try {
      const res = await fetch('/api/seranking/test');
      const json = await res.json();
      markConn('seranking', json);
      setSeRankingStatus(
        json.ok
          ? `Connected: ${json.sites.map((s: any) => `${s.title} (${s.keywordCount} keywords)`).join(', ')}. ${json.unitsLeft}/${json.unitsLimit} units left.`
          : `Failed: ${json.error}`
      );
    } catch (err: any) {
      setSeRankingStatus('Failed: ' + err.message);
    }
  }

  async function loadSeRankings() {
    setLoadingSeRanking(true);
    try {
      const res = await fetch('/api/seranking/rankings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSeRankings(json);
    } catch (err: any) {
      setSeRankingStatus('Failed: ' + err.message);
    } finally {
      setLoadingSeRanking(false);
    }
  }

  async function loadCrawls() {
    setLoadingCrawls(true);
    try {
      const res = await fetch('/api/technical');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCrawls(json);
    } catch (err: any) {
      setCrawlStatus('Failed: ' + err.message);
    } finally {
      setLoadingCrawls(false);
    }
  }

  async function uploadCrawl(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCrawl(true);
    setCrawlStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/technical/import', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCrawlStatus(`Imported ${json.total_urls} URLs from ${json.filename}.`);
      await loadCrawls();
    } catch (err: any) {
      setCrawlStatus('Failed: ' + err.message);
    } finally {
      setUploadingCrawl(false);
      e.target.value = '';
    }
  }

  async function testSerphouse() {
    setSerphouseStatus('Testing…');
    try {
      const res = await fetch('/api/serphouse/test');
      const json = await res.json();
      markConn('serphouse', json);
      setSerphouseStatus(
        json.ok
          ? 'Connected. API key is valid. Use "Check ranking" below for a live lookup (can take up to a minute).'
          : `Failed: ${json.error}`
      );
    } catch (err: any) {
      setSerphouseStatus('Failed: ' + err.message);
    }
  }

  async function checkSerphouse() {
    if (!serphouseKeyword.trim()) return;
    setLoadingSerphouse(true);
    setSerphouseResult(null);
    try {
      const res = await fetch(`/api/serphouse/check?keyword=${encodeURIComponent(serphouseKeyword)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSerphouseResult(json);
    } catch (err: any) {
      setSerphouseStatus('Failed: ' + err.message);
    } finally {
      setLoadingSerphouse(false);
    }
  }

  async function testSurfer() {
    setSurferStatus('Testing…');
    try {
      const res = await fetch('/api/surfer/test');
      const json = await res.json();
      markConn('surfer', json);
      setSurferStatus(
        json.ok
          ? `Connected: workspace "${json.workspaces[0]?.name}" (${json.workspaces[0]?.location}).`
          : `Failed: ${json.error}`
      );
    } catch (err: any) {
      setSurferStatus('Failed: ' + err.message);
    }
  }

  async function fetchSurferTerms() {
    if (!surferKeyword.trim()) return;
    if (!confirm(`This uses 1 Surfer credit to analyze "${surferKeyword}". Continue?`)) return;
    setLoadingSurfer(true);
    setSurferTerms(null);
    try {
      const res = await fetch('/api/surfer/terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: surferKeyword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSurferTerms(json.terms);
    } catch (err: any) {
      setSurferStatus('Failed: ' + err.message);
    } finally {
      setLoadingSurfer(false);
    }
  }

  const sum = (o: any) => Object.values(o || {}).reduce((a: any, b: any) => a + b, 0) as number;

  return (
    <div className="grid gap-10">
      <Section title="Publishing" description="Where drafts go live and how their SEO fields are written.">
        <ConnCard
          icon={Globe}
          title="WordPress connection"
          badge={<ConnBadge state={conn.wordpress} />}
          description={
            <>
              Configured via the .env file on the server (WORDPRESS_SITE_URL, WORDPRESS_USERNAME,
              WORDPRESS_APPLICATION_PASSWORD) and the Anthropic API key (ANTHROPIC_API_KEY).
            </>
          }
        >
          <Actions>
            <Button onClick={test}><PlugZap /> Test WordPress connection</Button>
          </Actions>
          {status && <Status>{status}</Status>}
        </ConnCard>

        <YoastFieldsCard />
      </Section>

      <Section title="Google" description="Search Console, Analytics and Business Profile.">
        <ConnCard
          icon={Search}
          className="xl:col-span-2"
          title="Google Search Console connection"
          badge={<ConnBadge state={conn.gsc} />}
          description={
            <>
              Read-only, via a service account (GOOGLE_SERVICE_ACCOUNT_KEY_PATH and GSC_SITE_URL in
              .env). Feeds real search demand data into future keyword/opportunity scoring.
            </>
          }
        >
          <Actions>
            <Button onClick={testGsc}><PlugZap /> Test GSC connection</Button>
            <Button variant="outline" onClick={loadQueries} disabled={loadingQueries}>
              <Spin on={loadingQueries} />
              {loadingQueries ? 'Loading…' : 'Load top queries (last 28 days)'}
            </Button>
          </Actions>
          {gscStatus && <Status>{gscStatus}</Status>}

          {queries && (
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Avg. position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queries.map((q, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium whitespace-normal">{q.query}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{q.clicks}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{q.impressions}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{(q.ctr * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{q.position.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </ConnCard>

        <ConnCard
          icon={BarChart3}
          title="GA4 (Google Analytics)"
          description="Read-only, via the same service account as Search Console (GA4_PROPERTY_ID in .env)."
        >
          <Actions>
            <Button onClick={loadGa4} disabled={loadingGa4}>
              <Spin on={loadingGa4} />
              {loadingGa4 ? 'Loading…' : 'Load last 28 days'}
            </Button>
          </Actions>
          {ga4Error && <Status>Error: {ga4Error}</Status>}

          {ga4Summary && (
            <Actions>
              <Pill>{ga4Summary.activeUsers} active users</Pill>
              <Pill>{ga4Summary.sessions} sessions</Pill>
              <Pill>{ga4Summary.conversions} conversions</Pill>
              <Pill>{(ga4Summary.engagementRate * 100).toFixed(1)}% engagement rate</Pill>
            </Actions>
          )}

          {ga4Pages && (
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Landing page</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Conversions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ga4Pages.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[260px] truncate" title={p.page}>{p.page}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{p.sessions}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{p.activeUsers}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{p.conversions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </ConnCard>

        <ConnCard
          icon={Building2}
          title="Google Business Profile"
          badge={<ConnBadge state={conn.gbp} />}
          description={
            <>
              Needs a one-time consent from whoever manages the Business Profile listing. Click
              Connect, sign in / approve on Google&apos;s screen, then come back and Test.
            </>
          }
        >
          <Actions>
            <Button nativeButton={false} render={<a href="/api/gbp/auth-url" target="_blank" rel="noreferrer" />}>
              <ExternalLink /> Connect Google Business Profile
            </Button>
            <Button variant="outline" onClick={testGbp}>Test connection</Button>
          </Actions>
          {gbpStatus && <Status>{gbpStatus}</Status>}
        </ConnCard>
      </Section>

      <Section title="CRM" description="Leads, consults and signed deals.">
        <ConnCard
          icon={Spline}
          className="xl:col-span-2"
          title="Zoho CRM"
          badge={<ConnBadge state={conn.zoho} />}
          description={
            <>
              Lead → consult → signed deal tracking (India data center). Needs a one-time consent
              from whoever manages the Zoho account.
            </>
          }
        >
          <Actions>
            <Button nativeButton={false} render={<a href="/api/zoho/auth-url" target="_blank" rel="noreferrer" />}>
              <ExternalLink /> Connect Zoho CRM
            </Button>
            <Button variant="outline" onClick={testZoho}>Test connection</Button>
            <Button variant="outline" onClick={loadZohoPipeline} disabled={loadingZoho}>
              <Spin on={loadingZoho} />
              {loadingZoho ? 'Loading…' : 'Load pipeline snapshot'}
            </Button>
          </Actions>
          {zohoStatus && <Status>{zohoStatus}</Status>}
          {zohoPipeline && (
            <div className="grid gap-4">
              <Actions>
                <Pill>{sum(zohoPipeline.leadsByStatus)} leads</Pill>
                <Pill>{sum(zohoPipeline.dealsByStage)} deals</Pill>
                <Pill>₹{zohoPipeline.totalDealValue?.toLocaleString('en-IN')} total deal value</Pill>
              </Actions>
              <div className="grid gap-4 md:grid-cols-2">
                <DataTable>
                  <TableHeader>
                    <TableRow><TableHead>Lead status</TableHead><TableHead className="text-right">Count</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(zohoPipeline.leadsByStatus || {}).map(([s, count]: any) => (
                      <TableRow key={s}><TableCell>{s}</TableCell><TableCell className="text-muted-foreground text-right tabular-nums">{count}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </DataTable>
                <DataTable>
                  <TableHeader>
                    <TableRow><TableHead>Deal stage</TableHead><TableHead className="text-right">Count</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(zohoPipeline.dealsByStage || {}).map(([stage, count]: any) => (
                      <TableRow key={stage}><TableCell>{stage}</TableCell><TableCell className="text-muted-foreground text-right tabular-nums">{count}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              </div>
            </div>
          )}

          <Separator />

          <Label className="text-muted-foreground font-normal">Lead source &amp; conversion breakdown</Label>
          <Actions>
            <Button variant="outline" onClick={loadZohoLeads} disabled={loadingZohoLeads}>
              <Spin on={loadingZohoLeads} />
              {loadingZohoLeads ? 'Loading…' : 'Load lead sources'}
            </Button>
          </Actions>

          {zohoLeads && (
            <div className="grid gap-4">
              <Actions>
                <Pill>{zohoLeads.totalLeads} total leads</Pill>
                <Pill>{zohoLeads.totalConverted} converted</Pill>
                <Pill>{(zohoLeads.overallConversionRate * 100).toFixed(1)}% conversion rate</Pill>
              </Actions>
              {zohoLeads.truncated && (
                <p className="text-muted-foreground text-sm">
                  Showing the first 1,000 leads only. Ask me to raise the limit if you have more.
                </p>
              )}
              <DataTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Converted</TableHead>
                    <TableHead className="text-right">Conversion rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zohoLeads.bySource.map((row: any) => (
                    <TableRow key={row.source}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          {row.source}
                          {row.isBlogLike && <Pill>blog/content</Pill>}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{row.converted}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{(row.conversionRate * 100).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                  {zohoLeads.bySource.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground text-center">No leads found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </DataTable>
            </div>
          )}
        </ConnCard>
      </Section>

      <Section title="Rankings & content" description="Rank tracking, ad-hoc checks and content term research.">
        <ConnCard
          icon={Search}
          title="SE Ranking"
          badge={<ConnBadge state={conn.seranking} />}
          description={
            <>
              Daily keyword rank tracking, via SERANKING_API_KEY in .env. Uses the existing
              &quot;Usaindiacfo.com&quot; rank-tracking project (20 keywords).
            </>
          }
        >
          <Actions>
            <Button onClick={testSeRanking}><PlugZap /> Test connection</Button>
            <Button variant="outline" onClick={loadSeRankings} disabled={loadingSeRanking}>
              <Spin on={loadingSeRanking} />
              {loadingSeRanking ? 'Loading…' : 'Load today’s rankings'}
            </Button>
          </Actions>
          {seRankingStatus && <Status>{seRankingStatus}</Status>}

          {seRankings && (
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seRankings.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">{r.keyword}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.position === 0 || r.position === null ? (
                        <span className="text-muted-foreground">not in top 100</span>
                      ) : (
                        r.position
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        'text-right tabular-nums ' +
                        (r.change > 0 ? 'text-emerald-600 dark:text-emerald-400' : r.change < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')
                      }
                    >
                      {r.change > 0 ? `+${r.change}` : r.change === 0 || r.change === null ? '-' : r.change}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{r.volume}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </ConnCard>

        <ConnCard
          icon={Wand2}
          title="Surfer SEO (content terms)"
          badge={<ConnBadge state={conn.surfer} />}
          description={
            <>
              Fetches the terms/keywords Surfer recommends including for a topic, via
              SURFER_API_KEY in .env. Each check uses 1 Surfer credit (asks for confirmation first).
            </>
          }
        >
          <Actions>
            <Button onClick={testSurfer}><PlugZap /> Test connection</Button>
          </Actions>
          {surferStatus && <Status>{surferStatus}</Status>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              placeholder="e.g. how to form an LLC from India"
              value={surferKeyword}
              onChange={(e) => setSurferKeyword(e.target.value)}
              className="sm:max-w-[320px]"
            />
            <Button variant="outline" onClick={fetchSurferTerms} disabled={loadingSurfer}>
              <Spin on={loadingSurfer} />
              {loadingSurfer ? 'Analyzing… (up to 90s)' : 'Get content terms (1 credit)'}
            </Button>
          </div>

          {surferTerms && (
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Suggested range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surferTerms.slice(0, 40).map((t, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">{t.term}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {t.target_range?.min}
                      {t.target_range?.max ? `–${t.target_range.max}` : '+'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </ConnCard>

        <ConnCard
          icon={Search}
          title="SERPHouse (ad-hoc rank check)"
          badge={<ConnBadge state={conn.serphouse} />}
          description={
            <>
              On-demand &quot;where do we rank for X right now&quot; lookup, via SERPHOUSE_API_KEY in .env.
              Separate from SE Ranking&apos;s daily tracked list. Use this for a quick one-off check.
            </>
          }
        >
          <Actions>
            <Button onClick={testSerphouse}><PlugZap /> Test connection</Button>
          </Actions>
          {serphouseStatus && <Status>{serphouseStatus}</Status>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              placeholder="e.g. virtual cfo services usa india"
              value={serphouseKeyword}
              onChange={(e) => setSerphouseKeyword(e.target.value)}
              className="sm:max-w-[320px]"
            />
            <Button variant="outline" onClick={checkSerphouse} disabled={loadingSerphouse}>
              <Spin on={loadingSerphouse} />
              {loadingSerphouse ? 'Checking…' : 'Check ranking'}
            </Button>
          </div>

          {serphouseResult && (
            <Actions>
              {serphouseResult.position ? (
                <>
                  <Pill>Position {serphouseResult.position}</Pill>
                  <span className="text-muted-foreground text-sm break-all">{serphouseResult.url}</span>
                </>
              ) : (
                <Pill tone="danger">Not found in results ({serphouseResult.totalResults} checked)</Pill>
              )}
            </Actions>
          )}
        </ConnCard>
      </Section>

      <Section title="Technical & experience" description="Crawls, behaviour analytics and page speed.">
        <ConnCard
          icon={Upload}
          className="xl:col-span-2"
          title="Screaming Frog (technical crawl)"
          description={
            <>
              No cloud API. Run a crawl in the Screaming Frog desktop app, export it as CSV
              (Internal → All), then upload the export here.
            </>
          }
        >
          <Actions>
            <Button type="button" disabled={uploadingCrawl} onClick={() => crawlInputRef.current?.click()}>
              {uploadingCrawl ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploadingCrawl ? 'Uploading…' : 'Upload crawl CSV'}
            </Button>
            <input ref={crawlInputRef} type="file" accept=".csv" onChange={uploadCrawl} className="hidden" />
            <Button variant="outline" onClick={loadCrawls} disabled={loadingCrawls}>
              <Spin on={loadingCrawls} />
              {loadingCrawls ? 'Loading…' : 'Load import history'}
            </Button>
          </Actions>
          {crawlStatus && <Status>{crawlStatus}</Status>}

          {crawls && crawls.length > 0 && (
            <DataTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Imported</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead className="text-right">URLs</TableHead>
                  <TableHead className="text-right">Broken</TableHead>
                  <TableHead className="text-right">Missing title</TableHead>
                  <TableHead className="text-right">Duplicate title</TableHead>
                  <TableHead className="text-right">Missing meta</TableHead>
                  <TableHead className="text-right">Thin content</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crawls.map((c) => (
                  <Fragment key={c.id}>
                    <TableRow>
                      <TableCell className="text-muted-foreground">{new Date(c.created_at).toLocaleString()}</TableCell>
                      <TableCell>{c.filename}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.total_urls}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{c.broken_count}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{c.missing_title_count}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{c.duplicate_title_count}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{c.missing_meta_count}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{c.thin_content_count}</TableCell>
                      <TableCell className="text-right">
                        {c.problem_urls?.length > 0 && (
                          <Button variant="outline" size="sm" onClick={() => setExpandedCrawlId(expandedCrawlId === c.id ? null : c.id)}>
                            {expandedCrawlId === c.id ? 'Hide issues' : 'View issues'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedCrawlId === c.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={9} className="bg-muted/30">
                          <DataTable>
                            <TableHeader>
                              <TableRow><TableHead>URL</TableHead><TableHead>Issues</TableHead></TableRow>
                            </TableHeader>
                            <TableBody>
                              {c.problem_urls.map((p: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell className="text-muted-foreground whitespace-normal break-all">{p.url}</TableCell>
                                  <TableCell className="text-muted-foreground whitespace-normal">{p.issues.join(', ')}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </DataTable>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </DataTable>
          )}
          {crawls && crawls.length === 0 && <p className="text-muted-foreground text-sm">No crawls imported yet.</p>}
        </ConnCard>

        <ConnCard
          icon={MousePointerClick}
          title="Microsoft Clarity"
          description={
            <>
              Behavior analytics: heatmaps, rage clicks, dead clicks, session friction. Via
              CLARITY_API_TOKEN in .env (max 3-day lookback per Clarity&apos;s API limit).
            </>
          }
        >
          <Actions>
            <Button onClick={loadClarity} disabled={loadingClarity}>
              <Spin on={loadingClarity} />
              {loadingClarity ? 'Loading…' : 'Load last 3 days'}
            </Button>
          </Actions>
          {clarityError && <Status>Error: {clarityError}</Status>}

          {clarityData && (
            <Actions>
              <Pill>{clarityData.Traffic?.totalSessionCount ?? 0} sessions</Pill>
              <Pill>{clarityData.Traffic?.distinctUserCount ?? 0} distinct users</Pill>
              <Pill tone={clarityData.RageClickCount?.sessionsCount > 0 ? 'danger' : 'success'}>
                {clarityData.RageClickCount?.sessionsCount ?? 0} rage-click sessions
              </Pill>
              <Pill tone={clarityData.DeadClickCount?.sessionsCount > 0 ? 'danger' : 'success'}>
                {clarityData.DeadClickCount?.sessionsCount ?? 0} dead-click sessions
              </Pill>
              <Pill tone={clarityData.ScriptErrorCount?.sessionsCount > 0 ? 'danger' : 'success'}>
                {clarityData.ScriptErrorCount?.sessionsCount ?? 0} JS error sessions
              </Pill>
            </Actions>
          )}
          {clarityData && clarityData.Traffic?.totalSessionCount === 0 && (
            <p className="text-muted-foreground text-sm">No sessions recorded yet. Clarity was just installed, give it a few hours.</p>
          )}
        </ConnCard>

        <ConnCard
          icon={Gauge}
          title="PageSpeed Insights & CrUX"
          description={
            <>
              Lab scores (Lighthouse) plus real-user Core Web Vitals (CrUX field data), via
              PAGESPEED_API_KEY in .env.
            </>
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Input
              type="text"
              value={pageSpeedUrl}
              onChange={(e) => setPageSpeedUrl(e.target.value)}
              className="sm:max-w-[360px]"
            />
            <Actions>
              <Button onClick={() => checkPageSpeed('mobile')} disabled={loadingPageSpeed}>
                <Spin on={loadingPageSpeed} />
                {loadingPageSpeed ? 'Checking…' : 'Check mobile'}
              </Button>
              <Button variant="outline" onClick={() => checkPageSpeed('desktop')} disabled={loadingPageSpeed}>
                Check desktop
              </Button>
            </Actions>
          </div>
          {pageSpeedError && <Status>Error: {pageSpeedError}</Status>}

          {pageSpeedResult && (
            <div className="grid gap-4">
              <Actions>
                <Pill>Performance {pageSpeedResult.scores.performance}</Pill>
                <Pill>Accessibility {pageSpeedResult.scores.accessibility}</Pill>
                <Pill>Best practices {pageSpeedResult.scores.bestPractices}</Pill>
                <Pill>SEO {pageSpeedResult.scores.seo}</Pill>
              </Actions>
              <DataTable>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>LCP</TableHead>
                    <TableHead>CLS</TableHead>
                    <TableHead>TBT / INP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Lab (this test run)</TableCell>
                    <TableCell>{pageSpeedResult.labMetrics.lcp}</TableCell>
                    <TableCell>{pageSpeedResult.labMetrics.cls}</TableCell>
                    <TableCell>{pageSpeedResult.labMetrics.tbt}</TableCell>
                  </TableRow>
                  {pageSpeedResult.fieldData && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Real users (CrUX, 28-day)</TableCell>
                      <TableCell>{pageSpeedResult.fieldData.lcp} ms</TableCell>
                      <TableCell>{pageSpeedResult.fieldData.cls}</TableCell>
                      <TableCell>{pageSpeedResult.fieldData.inp} ms</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </DataTable>
              {pageSpeedResult.fieldData ? (
                <p className="text-muted-foreground text-sm">Overall CrUX category: {pageSpeedResult.fieldData.overallCategory}</p>
              ) : (
                <p className="text-muted-foreground text-sm">No CrUX field data available for this URL (needs enough real-world traffic).</p>
              )}
            </div>
          )}
        </ConnCard>
      </Section>
    </div>
  );
}

'use client';

// Topics: what is worth writing about today, researched every morning at 10:00 IST. From each
// topic: have the dashboard write a blog or a LinkedIn article, or upload your own piece for an
// audit, a comparison with the research, and a finalized version.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, FileText, Loader2, Newspaper, RefreshCw, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRole } from '@/hooks/use-role';
import { jobsChanged } from '@/components/shared/job-progress';

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');
const KIND: Record<string, string> = { news: 'News', update: 'News', evergreen: 'Evergreen' };

function TopicCard({ t, canWork, onChanged }: { t: any; canWork: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  async function act(action: string, extra: any = {}) {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/topics/${t.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      jobsChanged();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function upload(file: File) {
    setBusy('manual');
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/topics/${t.id}`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      jobsChanged();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  const a = t.audit;
  const cmp = t.comparison;
  const draftLink = (d: any, label: string) => d && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/?tab=drafts&draft=${d.id}`}><FileText />{label}: {d.status === 'published' ? 'published' : d.status.replace('_', ' ')}</Link>;
  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{t.title}</div>
          <div className="text-xs text-muted-foreground">{KIND[t.kind] || t.kind}{t.published_at ? ` · published ${fmt(t.published_at)}` : ''}</div>
        </div>
        <button type="button" className="flex items-center gap-1 text-xs text-primary underline" onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          {open ? 'Hide details' : 'Why, keywords and sources'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          {t.why && <p>{t.why}</p>}
          {t.relevance && <RelevanceBox r={t.relevance} />}
          {t.keywords?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {t.keywords.map((k: string) => <span key={k} className="rounded-full border px-2 py-px text-xs">{k}</span>)}
            </div>
          )}
          {t.sources?.length > 0 && (
            <ul className="ml-4 list-disc text-xs">
              {t.sources.map((s: any, i: number) => <li key={i}><a className="text-primary underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>)}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {t.draft ? draftLink(t.draft, 'Blog') : t.status === 'blog' ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Blog being written (see the bar at the top)</span> : canWork && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('blog')}>{busy === 'blog' ? <Loader2 className="animate-spin" /> : <FileText />}Write a blog</Button>
        )}
        {t.article ? draftLink(t.article, 'LinkedIn article') : t.status === 'article' && !t.article ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Article being written</span> : canWork && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('article')}>{busy === 'article' ? <Loader2 className="animate-spin" /> : <Newspaper />}Write a LinkedIn article</Button>
        )}
        {canWork && (
          <>
            <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()} title="A blog or article you wrote yourself (.docx): it is audited, compared with this research, and a finalized version can be made">
              {busy === 'manual' ? <Loader2 className="animate-spin" /> : <Upload />}
              {a ? 'Upload a new version' : 'Upload my own piece'}
            </Button>
          </>
        )}
      </div>
      {a && (
        <div className="mt-3 space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
          <div className="font-medium">Your piece: {a.title}</div>
          {a.audit_status === 'running' ? (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Auditing (a few minutes)…</p>
          ) : a.audit_status === 'failed' ? (
            <p className="text-destructive">Audit failed: {a.audit_error}</p>
          ) : (
            <>
              <p><strong>{a.verdict === 'READY' ? 'Ready' : 'Needs work'}.</strong> {a.summary} {a.issues?.length ? `${a.issues.length} issue(s) found.` : ''} <Link className="text-primary underline" href="/?tab=audit">Open the audit</Link></p>
              {!cmp ? (
                canWork && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('compare')}>{busy === 'compare' ? <Loader2 className="animate-spin" /> : null}Compare with the research</Button>
              ) : (
                <div className="space-y-1">
                  <div><strong>Comparison: {cmp.verdict}.</strong> {cmp.summary} ({cmp.words} words)</div>
                  {cmp.keywordUse?.length > 0 && <div className="text-xs">Keywords: {cmp.keywordUse.map((k: any) => `${k.keyword} (${k.count ? `used ${k.count}×` : 'not used'})`).join(', ')}</div>}
                  {cmp.covered?.length > 0 && <div><span className="text-emerald-700 dark:text-emerald-400">Covers:</span><ul className="ml-4 list-disc text-xs">{cmp.covered.map((c: any, i: number) => <li key={i}>{c.point}{c.where ? <span className="text-muted-foreground"> (&quot;{c.where}&quot;)</span> : ''}</li>)}</ul></div>}
                  {cmp.missing?.length > 0 && <div><span className="text-red-600 dark:text-red-400">Missing:</span><ul className="ml-4 list-disc text-xs">{cmp.missing.map((c: any, i: number) => <li key={i}>{c.point}{c.why ? <span className="text-muted-foreground"> {c.why}</span> : ''}</li>)}</ul></div>}
                  {cmp.weaker?.length > 0 && <div><span className="text-amber-700 dark:text-amber-400">Weaker than the brief:</span><ul className="ml-4 list-disc text-xs">{cmp.weaker.map((c: any, i: number) => <li key={i}>{c.point}{c.fix ? <span className="text-muted-foreground"> Fix: {c.fix}</span> : ''}</li>)}</ul></div>}
                  {canWork && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act('compare')}>Compare again</Button>}
                </div>
              )}
              {a.rewrite_status === 'generating' ? (
                <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Writing the finalized version (2 to 5 minutes)…</p>
              ) : a.hasRewrite ? (
                <p>Finalized version ready: <Link className="text-primary underline" href="/?tab=audit">review and publish it on the Check a blog page</Link>{a.rewrite_error ? ` (last attempt failed: ${a.rewrite_error})` : ''}.</p>
              ) : a.rewrite_error ? (
                <p className="text-destructive">The finalized version failed: {a.rewrite_error}</p>
              ) : null}
              {canWork && a.rewrite_status !== 'generating' && (
                <div className="space-y-1">
                  <textarea className="w-full max-w-xl rounded-md border bg-background p-2 text-xs" rows={3} placeholder="Reviewer comments: what to change in the finalized version (optional)" value={comments} onChange={(e) => setComments(e.target.value)} />
                  <Button size="sm" disabled={busy !== null} onClick={() => act('finalize', { comments })}>{busy === 'finalize' ? <Loader2 className="animate-spin" /> : null}{a.hasRewrite ? 'Make a new finalized version' : 'Generate the finalized version'}</Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </li>
  );
}

export default function TopicsTab() {
  const [data, setData] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const who = useRole();
  const canWork = who.can('content.work');
  const load = useCallback(async () => {
    setData(await fetch('/api/topics').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  // Poll while a research, blog, article, audit or rewrite is in progress.
  const busy = Boolean(data?.topics?.some((t: any) => (t.status === 'blog' && !t.draft) || (t.status === 'article' && !t.article) || t.audit?.audit_status === 'running' || t.audit?.rewrite_status === 'generating')) || starting;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function research() {
    setStarting(true);
    await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'research' }) }).catch(() => null);
    jobsChanged();
    setTimeout(() => {
      setStarting(false);
      load();
    }, 90000);
  }

  if (!data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading topics…</div>;
  const todays = (data.topics || []).filter((t: any) => t.day === data.today);
  const news = todays.filter((t: any) => t.kind !== 'evergreen');
  const evergreen = todays.filter((t: any) => t.kind === 'evergreen');
  const earlier = (data.topics || []).filter((t: any) => t.day !== data.today);
  const researchedToday = data.lastRun?.day === data.today && !data.lastRun?.error;
  const list = (l: any[]) => <ul className="space-y-3">{l.map((t: any) => <TopicCard key={t.id} t={t} canWork={canWork} onChanged={load} />)}</ul>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>News from the last 24 hours</CardTitle>
          <CardDescription>
            Every morning at 10:00 IST the dashboard searches what was published in the last 24 hours that matters to our company, our services, our clients and our niche: rule, law and deadline changes, official notices and business news. Each one shows its source and publish time; anything older is left out. Press Research now any time for a fresh look. From a topic, have the dashboard write a blog (full research and fact check) or a LinkedIn article, or upload your own piece to audit it, compare it with the research, and make a finalized version.
            {data.lastRun?.at ? ` Last research: ${fmt(data.lastRun.at)}${data.lastRun.error ? ` (failed: ${data.lastRun.error})` : ''}.` : ' No research has run yet.'}
          </CardDescription>
          {canWork && (
            <CardAction>
              <Button variant="outline" disabled={starting} onClick={research}>
                <RefreshCw className={starting ? 'animate-spin' : ''} />
                {starting ? 'Researching (1 to 2 minutes)…' : 'Research now'}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {news.length ? list(news) : <p className="text-sm text-muted-foreground">{researchedToday ? 'No news from the last 24 hours fits our company, services or clients. Use the evergreen topics below, or press Research now later in the day.' : 'Today has not been researched yet. Press Research now or wait for the 10:00 IST run.'}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evergreen topics</CardTitle>
          <CardDescription>Subjects that stay useful for our clients, from the strategy keywords and our services, not yet on the website. New ones every day.</CardDescription>
        </CardHeader>
        <CardContent>{evergreen.length ? list(evergreen) : <p className="text-sm text-muted-foreground">None for today yet.</p>}</CardContent>
      </Card>

      {earlier.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier topics you started</CardTitle>
            <CardDescription>Topics from earlier days that already have a blog, an article or an upload. Untouched old topics are not shown.</CardDescription>
          </CardHeader>
          <CardContent>{list(earlier)}</CardContent>
        </Card>
      )}
    </div>
  );
}

// Why the topic matters to USAIndiaCFO and whether it is worth writing, so the team can decide
// before spending a draft and a review on it.
const VERDICT: Record<string, { label: string; cls: string }> = {
  write: { label: 'Worth writing', cls: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400' },
  maybe: { label: 'Optional: decide', cls: 'border-amber-600/40 text-amber-700 dark:text-amber-400' },
  skip: { label: 'Probably skip', cls: 'border-red-600/40 text-red-700 dark:text-red-400' },
};
function RelevanceBox({ r }: { r: any }) {
  const v = VERDICT[r.verdict] || VERDICT.maybe;
  return (
    <div className="space-y-1 rounded-lg border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        Why this matters for USAIndiaCFO
        <span className={`rounded-full border px-2 py-px text-xs font-medium ${v.cls}`}>{v.label}</span>
      </div>
      {r.forUs && <p><span className="text-muted-foreground">Relevant because: </span>{r.forUs}</p>}
      {r.useful && <p><span className="text-muted-foreground">Useful for clients: </span>{r.useful}</p>}
      {r.reason && <p><span className="text-muted-foreground">Write it? </span>{r.reason}</p>}
    </div>
  );
}

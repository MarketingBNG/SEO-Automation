'use client';

// Home: what waits for a decision, what publishes next, what needs attention and what went live.
// Every item links straight to the place where it is handled.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, Download, FileText, KeyRound, Loader2, Settings, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRole } from '@/hooks/use-role';

const fmtDate = (s?: string | null) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');

function factCheck(fc: any) {
  if (!fc) return 'Fact check: not run yet';
  if (!('ok' in fc)) return "Fact check: the writer's own check was clean";
  return fc.ok ? `Fact check: verified (${fc.rounds} round${fc.rounds === 1 ? '' : 's'}${fc.corrected ? ', corrections applied' : ''})` : `Fact check: could not verify every claim (${fc.rounds} rounds)`;
}

// One blog waiting for a decision: the cover, when it publishes, and Approve / Reject.
function ApprovalCard({ row, reviewers, canReview, onDone }: { row: any; reviewers: string[]; canReview: boolean; onDone: (msg: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decide(action: 'approve' | 'reject') {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/strategy/schedule/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, feedback, reviewer }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onDone(action === 'approve' ? `Approved "${row.title}". It publishes at its slot.` : `Rejected "${row.title}". It is rewritten with your feedback and comes back for review.`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  const plan = row.publish_plan;
  return (
    <li className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[150px_1fr] ${row.overdue ? 'border-red-500/50 bg-red-500/5' : 'bg-card'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {row.cover_url ? <img src={row.cover_url} alt="" loading="lazy" className="w-full rounded-lg border object-cover" /> : <div />}
      <div className="min-w-0 space-y-1 text-sm">
        <div className="font-semibold">{row.title}</div>
        <div className="text-xs text-muted-foreground">
          {row.author ? `By ${row.author}. ` : ''}
          {factCheck(row.fact_check)}.{row.cta?.service ? ` Call to action: ${row.cta.service}.` : ''}
        </div>
        {plan && (
          <div className={`text-xs ${row.needs_expert ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
            <strong>{plan.headline}.</strong> <span className={row.needs_expert ? '' : 'text-muted-foreground'}>{plan.detail}</span>
          </div>
        )}
        {row.overdue && <div className="text-xs font-semibold text-red-600 dark:text-red-400">Review overdue: it has waited more than 48 hours.</div>}
        {row.hold_reasons?.length > 0 && <ul className="ml-4 list-disc text-xs text-muted-foreground">{row.hold_reasons.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/?tab=drafts&draft=${row.draft_id}`}>
            <FileText />
            Open the draft
          </Link>
          <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/api/drafts/${row.draft_id}/download`} download>
            <Download />
            Download Word
          </a>
          {canReview && row.needs_expert && (
            <select className="h-8 w-52 rounded-md border bg-background px-1 text-xs" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="CA/CPA reviewer">
              <option value="">Reviewed by (CA/CPA)...</option>
              {reviewers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {canReview && (
            <>
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={busy || (row.needs_expert && !reviewer)} onClick={() => decide('approve')}>
                {busy ? <Loader2 className="animate-spin" /> : <ThumbsUp />}
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting((v) => !v)}>
                <ThumbsDown />
                Reject
              </Button>
            </>
          )}
        </div>
        {canReview && row.needs_expert && !reviewers.length && <div className="text-xs text-muted-foreground">Type the reviewer as &quot;Name, CA&quot;.</div>}
        {rejecting && (
          <div className="space-y-1 pt-1">
            <textarea className="w-full max-w-lg rounded-md border bg-background p-2 text-xs" rows={3} placeholder="Why are you rejecting it? What should change?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <Button size="sm" variant="destructive" disabled={busy || feedback.trim().length < 10} onClick={() => decide('reject')}>
              Send back for a rewrite
            </Button>
          </div>
        )}
        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      </div>
    </li>
  );
}

export default function HomeTab() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const who = useRole();
  const canReview = who.can('strategy.approve');
  const canWork = who.can('content.work');
  const load = useCallback(async () => {
    setData(await fetch('/api/home').then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading what needs you today…
      </div>
    );
  }
  const waiting = (data.approvals?.length || 0) + (canWork ? data.looseDrafts?.length || 0 : 0);
  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm">{msg}</div>}

      <div className="flex flex-wrap gap-2">
        {canWork && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/?tab=keywords"><KeyRound />Write a blog{data.pendingKeywords ? ` (${data.pendingKeywords} keyword${data.pendingKeywords === 1 ? '' : 's'} waiting)` : ''}</Link>}
        <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/?tab=strategy"><CalendarClock />Monthly Strategy{data.strategy ? ` (${data.strategy.period})` : ''}</Link>
        {canWork && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/?tab=drafts"><FileText />Drafts &amp; Review</Link>}
        {who.can('settings.change') && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/?tab=settings"><Settings />Settings</Link>}
      </div>

      {data.attention?.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" />Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.attention.map((a: any, i: number) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <Link className="font-medium text-primary underline" href={a.href}>{a.title}</Link>
                  <span className="text-muted-foreground">{a.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Waiting for your approval{waiting ? ` (${waiting})` : ''}</CardTitle>
          <CardDescription>Each blog shows the cover and the author it goes out with, and exactly when it publishes. A blog in review publishes on its own after 48 hours unless someone rejects it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.approvals?.length > 0 ? (
            <ul className="space-y-3">
              {data.approvals.map((r: any) => (
                <ApprovalCard key={r.id} row={r} reviewers={data.reviewers || []} canReview={canReview} onDone={(m) => { setMsg(m); load(); }} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No calendar blog is waiting for a decision.</p>
          )}
          {canWork && data.looseDrafts?.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium">Drafts written from the &quot;Write a blog&quot; page, waiting for review (not on the calendar; they publish only when you press Publish)</div>
              <ul className="space-y-1 text-sm">
                {data.looseDrafts.map((d: any) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link className="text-primary underline" href={`/?tab=drafts&draft=${d.id}`}>{d.title || d.keyword || `Draft ${d.id}`}</Link>
                    <span className="text-xs text-muted-foreground">{d.word_count ? `${d.word_count} words. ` : ''}{d.author ? `By ${d.author}. ` : ''}Updated {fmtDate(d.updated_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Publishing next</CardTitle>
            <CardDescription>{data.strategy ? `From the ${data.strategy.period} strategy. Each one is written 72 hours before its slot and reviewed for 48 hours.` : 'No approved strategy yet, so nothing is scheduled.'}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.upcoming?.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {data.upcoming.map((r: any) => (
                  <li key={r.id} className="flex gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.cover_url ? <img src={r.cover_url} alt="" loading="lazy" className="mt-0.5 h-10 w-[72px] shrink-0 rounded border object-cover" /> : <div className="mt-0.5 h-10 w-[72px] shrink-0 rounded border bg-muted" title="The cover is made when the draft is written" />}
                    <div className="min-w-0">
                      <div className="font-medium">{r.draft_id ? <Link className="hover:underline" href={`/?tab=drafts&draft=${r.draft_id}`}>{r.title}</Link> : r.title}</div>
                      <div className="text-xs text-muted-foreground"><strong className="text-foreground">{r.publish_plan?.headline}.</strong> {r.publish_plan?.detail}{r.author ? ` By ${r.author}.` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" />Recently published</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent?.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {data.recent.map((d: any) => (
                  <li key={d.id}>
                    <a className="font-medium text-primary hover:underline" href={d.wp_post_url} target="_blank" rel="noreferrer">{d.title}</a>
                    <div className="text-xs text-muted-foreground">{d.author ? `By ${d.author}. ` : ''}{fmtDate(d.updated_at)}. <Link className="underline" href={`/?tab=drafts&draft=${d.id}`}>How it performs</Link> · <a className="underline" href={`/api/wordpress/download?url=${encodeURIComponent(d.wp_post_url)}`} download>Download Word</a></div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing published from the dashboard yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

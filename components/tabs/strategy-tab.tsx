'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';
import { useManualTasks, ManualTasksBanner, ManualTaskList } from '@/components/shared/manual-tasks';
import { useRole } from '@/hooks/use-role';
import { cn } from 'cn';
import Link from 'next/link';

// Strategy section (v2): one monthly SEO / AEO / GEO strategy in 11 fixed sections, one approval,
// then the month runs automatically. All UI text avoids em dashes by design.

type Col = { key: string; label: string; edit?: 'text' | 'number' | 'tags' | 'check'; render?: (row: any) => ReactNode };

const CHANNELS = ['SEO', 'AEO', 'GEO'];

// A number with its source and date range, or "DATA MISSING: <metric>".
function M({ m }: { m: any }) {
  if (!m) return <span className="text-muted-foreground">n/a</span>;
  if (m.value === null || m.value === undefined) return <span className="font-medium text-red-600 dark:text-red-400">{m.missing || 'DATA MISSING'}</span>;
  return (
    <span title={`${m.source}, ${m.range}`}>
      {Number(m.value).toLocaleString()}
      <span className="block text-[11px] text-muted-foreground">{m.source}, {m.range}</span>
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags?.length) return <Badge variant="destructive">No tag</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="secondary">{t}</Badge>
      ))}
    </span>
  );
}

function Section({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

const TASK_STATUS: Record<string, string> = {
  planned: 'Automatic, waiting for its date',
  sent: 'In Smartlead',
  duplicate: 'Already in Smartlead',
  no_contact: 'No contact found',
  skipped: 'Skipped',
};

const usd = (n: number) => `$${n.toFixed(2)}`;

// Mirrors lib/strategy/fixer.ts fixKind: what the automatic fixer will do with each issue.
const fixKindOf = (issue: string) =>
  /^Broken link to /i.test(issue || '') ? 'broken_link' : /\b4\d\d status code/i.test(issue || '') ? 'redirect' : /missing title|duplicate title/i.test(issue || '') ? 'title' : /meta description/i.test(issue || '') ? 'meta' : /thin content/i.test(issue || '') ? 'thin' : 'manual';
const FIX_LABEL: Record<string, string> = { broken_link: 'Yes', redirect: 'Yes (Redirection plugin)', title: 'Yes', meta: 'Yes', thin: 'Yes (adds FAQ)', manual: 'Needs a developer' };

// A table that becomes editable in Edit mode. Cells with `edit` get an input.
function EditTable({ rows: rowsIn, cols, editing, onChange, empty }: { rows: any[]; cols: Col[]; editing: boolean; onChange: (rows: any[]) => void; empty?: string }) {
  const rows = rowsIn || [];
  if (!rows.length && !editing) return <p className="text-sm text-muted-foreground">{empty || 'Nothing planned.'}</p>;
  const set = (i: number, key: string, v: any) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <>
    {editing && (
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { tags: [] }])}>Add row</Button>
    )}
    <DataTable head={[...cols.map((c) => c.label), ...(editing ? [''] : [])]}>
      {rows.map((r, i) => (
        <tr key={i}>
          {cols.map((c) => (
            <td key={c.key} className={TD}>
              {editing && c.edit === 'check' ? (
                <input type="checkbox" checked={r[c.key] !== false} onChange={(e) => set(i, c.key, e.target.checked)} />
              ) : editing && c.edit === 'tags' ? (
                <span className="flex gap-2">
                  {CHANNELS.map((ch) => (
                    <label key={ch} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(r.tags || []).includes(ch)}
                        onChange={(e) => set(i, 'tags', e.target.checked ? [...(r.tags || []), ch] : (r.tags || []).filter((t: string) => t !== ch))}
                      />
                      {ch}
                    </label>
                  ))}
                </span>
              ) : editing && c.edit ? (
                <Input
                  className="h-7 min-w-24"
                  type={c.edit === 'number' ? 'number' : 'text'}
                  value={r[c.key] ?? ''}
                  onChange={(e) => set(i, c.key, c.edit === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                />
              ) : c.render ? (
                c.render(r)
              ) : c.key === 'tags' ? (
                <Tags tags={r.tags} />
              ) : (
                String(r[c.key] ?? '')
              )}
            </td>
          ))}
          {editing && (
            <td className={TD}>
              <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
            </td>
          )}
        </tr>
      ))}
    </DataTable>
    </>
  );
}

const fmtDate = (s?: string | null) => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');

// When each part of the strategy starts running. Before approval nothing runs; everything starts
// from the approval, and blogs and outreach then follow their own dates in the plan.
function ImplementationStart({ plan, approved, approvedAt }: { plan: any; approved: boolean; approvedAt?: string | null }) {
  const sorted = (dates: (string | undefined)[]) => dates.filter(Boolean).map(String).sort();
  const blogDates = sorted((plan.blogPlan?.calendar || []).map((b: any) => b.publishDate));
  const firstBlog = blogDates[0];
  const lastBlog = blogDates[blogDates.length - 1];
  const firstDraft = firstBlog ? new Date(Date.parse(firstBlog.replace(' ', 'T') + 'Z') - 72 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : null;
  const emailLinks = (plan.backlinks || []).filter((b: any) => !/internal|directory|citation/i.test(b.method || ''));
  const linkDates = sorted(emailLinks.map((b: any) => b.sendDate));
  const day = (d?: string) => (d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }) : 'not planned');
  const fixes = (plan.technical?.fixes || []).filter((f: any) => f.apply !== false).length;
  const start = approved ? `approval (${fmtDate(approvedAt)})` : 'approval';
  // Phases mirror what the scheduler really does: spread out so nothing lands in one burst.
  const phases = [
    { phase: '1. Approval', when: approved ? fmtDate(approvedAt) : 'When you click Approve', what: 'Blog calendar, backlink tasks and ticked fixes are queued. Daily rank checks begin.', why: 'One approval starts everything; nothing runs before it.', time: 'Instant' },
    { phase: '2. Technical fixes', when: `From ${start}, every 15 minutes`, what: `${fixes} ticked fix(es): titles, meta descriptions, broken links, redirects, FAQs`, why: 'Small, safe changes first. Max 5 per run and 20 per day, so the site changes gradually and AI cost is spread out.', time: fixes ? `About ${Math.ceil(fixes / 20)} day(s)` : 'Nothing to fix' },
    { phase: '3. Speed', when: `First run after ${start}, then daily`, what: 'Page cache plugin (if none), then large images to WebP', why: 'No AI credits used. 5 images a day so every change can be checked; the cache is removed again if PageSpeed drops.', time: 'Cache: day 1. Images: 5 a day until done' },
    { phase: '4. Blogs', when: firstBlog ? `${fmtDate(firstDraft)} to ${fmtDate(lastBlog)}` : 'Per calendar', what: `${blogDates.length} blog(s): deep research draft, fact check until two clean checks, 48-hour review (approve or reject with feedback), publish under a partner\'s name`, why: 'Precision work at full quality, one draft at a time, written 72 hours ahead of each slot so the manager gets the full 48 hours. Never rushed or batched.', time: blogDates.length ? `${blogDates.length} slot(s) across the 30 days` : '-' },
    { phase: '5. Backlink outreach', when: linkDates.length ? `${day(linkDates[0])} to ${day(linkDates[linkDates.length - 1])}, weekdays` : 'Per send dates', what: `${emailLinks.length} site(s) added to the Smartlead campaign with a personal opening line`, why: 'Max 5 leads a day so outreach never looks like spam; Smartlead spaces the emails and follow-ups.', time: emailLinks.length ? `At least ${Math.ceil(emailLinks.length / 5)} working day(s)` : '-' },
    { phase: '6. Checks', when: 'Daily and every Monday', what: 'Daily rank check (alert on a 5+ drop); weekly plan vs actual; new links verified in SE Ranking', why: 'Catches problems early without extra AI cost.', time: 'Whole 30 days' },
  ];
  return (
    <span>
      {approved ? `Started on ${fmtDate(approvedAt)}.` : 'Nothing runs until you approve. Everything starts automatically on approval, in phases:'}
      <details className="mt-1 rounded-md border p-2">
        <summary className="cursor-pointer font-medium">Implementation timeline: phases, when, why and how long</summary>
        <div className="mt-2 overflow-x-auto">
          <DataTable head={['Phase', 'When', 'What', 'Why this way', 'Time needed']}>
            {phases.map((ph) => (
              <tr key={ph.phase}>
                <td className={TD}>{ph.phase}</td>
                <td className={TD}>{ph.when}</td>
                <td className={TD}>{ph.what}</td>
                <td className={TD}>{ph.why}</td>
                <td className={TD}>{ph.time}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </span>
  );
}

// How much of the strategy is done, and the estimated AI cost for its 30 days.
function StrategyProgress({ id, approved }: { id: number; approved: boolean }) {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => {
    setD(await fetch(`/api/strategy/${id}/progress`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  if (!d) return null;
  async function toggle(t: any) {
    await fetch(`/api/strategy/backlinks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'planned' : 'done' }) });
    load();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{approved ? 'How much of this strategy is done' : 'Estimated cost of this strategy'}</CardTitle>
        <CardDescription>
          {approved
            ? `Counts published blogs and finished backlink tasks.${d.window.daysUsed ? ` Day ${d.window.daysUsed} of 30.` : ''}`
            : 'Progress starts counting once the strategy is approved.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {approved && (
          <>
            <div>
              <div className="flex items-center justify-between"><span className="font-medium">Overall</span><span className="tabular-nums">{d.percent}%</span></div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${d.percent}%` }} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="font-medium">Blogs: {d.blogs.published} of {d.blogs.total} published</div>
                <div className="text-xs text-muted-foreground">{d.blogs.inReview} in review, {d.blogs.drafting} being written, {d.blogs.planned} planned, {d.blogs.held} held</div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${d.blogs.total ? (d.blogs.published / d.blogs.total) * 100 : 0}%` }} /></div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="font-medium">Backlink tasks: {d.backlinks.done} of {d.backlinks.total} done</div>
                <div className="text-xs text-muted-foreground">Outreach runs automatically through Smartlead (up to 5 a day). Done means SE Ranking found the link. Only directory listings need a person; tick those off when done.</div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${d.backlinks.total ? (d.backlinks.done / d.backlinks.total) * 100 : 0}%` }} /></div>
              </div>
              {d.fixes?.total > 0 && (
                <div className="rounded-lg border p-3">
                  <div className="font-medium">Technical fixes: {d.fixes.applied} of {d.fixes.total} done</div>
                  <div className="text-xs text-muted-foreground">
                    {d.fixes.planned} waiting, {d.fixes.manual} need a person, {d.fixes.failed} failed. Up to 20 a day.
                    {d.fixes.lastRun ? ` Last run ${fmtDate(d.fixes.lastRun)}.` : ' Not started yet.'}
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(d.fixes.applied / d.fixes.total) * 100}%` }} /></div>
                </div>
              )}
            </div>
            {d.backlinks.tasks.length > 0 && (
              <details>
                <summary className="cursor-pointer">Backlink tasks ({d.backlinks.tasks.length})</summary>
                <ul className="mt-2 space-y-1">
                  {d.backlinks.tasks.map((t: any) => (
                    <li key={t.id} className="flex items-start gap-2">
                      {t.status === 'manual' || t.status === 'done' ? (
                        <input type="checkbox" className="mt-1" checked={t.status === 'done'} onChange={() => toggle(t)} title="Tick when done by a person" />
                      ) : (
                        <span className="mt-0.5 shrink-0 rounded border px-1.5 text-[11px] text-muted-foreground">{TASK_STATUS[t.status] || t.status}</span>
                      )}
                      <span>
                        {t.send_date} {t.method}: <strong>{t.target_site}</strong>{t.our_page ? ` for ${t.our_page}` : ''}
                        {t.status === 'manual' && <span className="ml-1 rounded border px-1.5 text-[11px] text-muted-foreground">Needs a person</span>}
                        {t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">Estimated AI (API) cost for the 30 days</span>
            <span className="text-lg font-semibold">{usd(d.cost.estimate)}</span>
          </div>
          {approved && <div className="text-xs text-muted-foreground">Spent so far since approval: {usd(d.cost.spentSinceApproval)}</div>}
          <table className="mt-2 w-full text-xs">
            <tbody>
              {d.cost.lines.map((l: any) => (
                <tr key={l.item}><td className="py-0.5">{l.item}</td><td className="text-right text-muted-foreground">{l.units} x {usd(l.unitCost)}{l.measured ? '' : ' (default)'}</td><td className="text-right">{usd(l.cost)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-xs text-muted-foreground">
            {d.cost.basis === 'measured' ? 'Based on what similar work actually cost on this account in the last 60 days.' : 'Lines marked (default) use typical costs until the dashboard has measured your own; the estimate gets more accurate after the first blogs. Fact checking can cost more for blogs that need many correction rounds.'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function StrategyView({ s, onChanged }: { s: any; onChanged: (v: any) => void }) {
  const plan = s.plan;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(plan);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState({ what: '', why: '' });
  const [editWhy, setEditWhy] = useState('');
  const [updateResult, setUpdateResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const approved = s.status === 'approved';
  const p = editing ? draft : plan;
  const manual = useManualTasks(s.id, approved);
  const who = useRole();
  const canEdit = who.can('strategy.edit');
  const canApprove = who.can('strategy.approve');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setDraft(plan);
  }, [plan, editing]);

  async function call(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Saves only the sections that changed; each save is one audit-log entry.
  async function saveEdits() {
    let latest = null;
    for (const section of ['summary', 'included', 'keywords', 'blogPlan', 'aeoGeo', 'backlinks', 'technical', 'targets']) {
      if (JSON.stringify(draft[section]) === JSON.stringify(plan[section])) continue;
      latest = await call('save', `/api/strategy/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section, value: draft[section], why: editWhy }) });
      if (!latest) return;
    }
    if (latest) onChanged(latest);
    setEditing(false);
    setEditWhy('');
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const ok = await call('upload', '/api/strategy/crawl', { method: 'POST', body: fd });
    if (ok) {
      const fresh = await call('reload', `/api/strategy/${s.id}`, { method: 'GET' });
      if (fresh) onChanged(fresh);
    }
  }

  async function approve() {
    const json = await call('approve', `/api/strategy/${s.id}/approve`, { method: 'POST' });
    if (json) onChanged(json);
  }

  // Adds what is new (automation steps, backlink targets, crawl fixes) without rebuilding the strategy.
  async function updateLatest() {
    setUpdateResult(null);
    const json = await call('update', `/api/strategy/${s.id}/refresh`, { method: 'POST' });
    if (json) {
      onChanged(json.view);
      setUpdateResult(json);
    }
  }

  async function logChange() {
    const json = await call('change', `/api/strategy/${s.id}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    if (json) {
      onChanged(json);
      setChange({ what: '', why: '' });
    }
  }

  const upd = (section: string, value: any) => setDraft((d: any) => ({ ...d, [section]: value }));
  const errors: string[] = s.validation?.errors || [];
  const warnings: string[] = s.validation?.warnings || [];
  const crawlFresh = s.crawl?.fresh;
  const declining: string[] = s.validation?.decliningChannels || [];

  return (
    <div className="space-y-4">
      {/* Screaming Frog gate banner */}
      {crawlFresh ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          Screaming Frog crawl uploaded on {fmtDate(s.crawl.uploadedAt)} by {s.crawl.uploadedBy || 'unknown'}.
        </div>
      ) : (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-bold">
          ACTION REQUIRED BEFORE APPROVAL: Upload the latest Screaming Frog crawl export (full links list) to the dashboard. The strategy cannot be approved without it.
        </div>
      )}

      <ManualTasksBanner m={manual} strategyId={s.id} />

      <StrategyProgress key={s.version} id={s.id} approved={approved} />

      {approved && (
        <Section title="Tasks for your team" description="Work in this strategy that a person has to do: profiles that need a sign-up and verification, and website fixes that need a developer. Each has a step-by-step guide with links and text to copy. Tick each one when done.">
          <ManualTaskList m={manual} />
        </Section>
      )}

      {/* Core objective, hardcoded */}
      <Card>
        <CardHeader>
          <CardTitle>Core objective</CardTitle>
          <CardDescription>{plan.coreObjective?.motive}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          {plan.coreObjective?.channels?.map((c: any) => (
            <div key={c.channel} className="rounded-lg border p-3">
              <div className="font-semibold">{c.channel}{declining.includes(c.channel) ? ' (top priority: flat or down last month)' : ''}</div>
              <div className="text-muted-foreground">{c.meaning}</div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-3">{plan.coreObjective?.signalNote}</p>
        </CardContent>
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <div className="font-semibold">Validation blocks approval ({errors.length})</div>
              <ul className="ml-5 list-disc">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <ul className="ml-5 list-disc">{warnings.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {plan.dataMissing?.length > 0 && (
        <div className="rounded-lg border p-3 text-sm">
          <div className="font-semibold">Data that could not be read</div>
          <ul className="ml-5 list-disc">{plan.dataMissing.map((m: string, i: number) => <li key={i}>DATA MISSING: {m}</li>)}</ul>
        </div>
      )}

      {/* 1 */}
      <Section title="1. Strategy summary">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Strategy period (30 days): </span>{p.summary.month}</div>
          <div><span className="text-muted-foreground">Approval status: </span>{approved ? `Approved by ${s.approved_by} on ${fmtDate(s.approved_at)} (version ${s.approved_version})` : `Waiting for approval (version ${s.version})`}</div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Implementation starts: </span><ImplementationStart plan={plan} approved={approved} approvedAt={s.approved_at} /></div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Core objective: </span>{plan.coreObjective?.motive}</div>
          {(['focus', 'strategyType', 'whyThisType'] as const).map((k) => (
            <div key={k} className="sm:col-span-2">
              <span className="text-muted-foreground">{k === 'focus' ? "This month's focus: " : k === 'strategyType' ? 'Strategy type: ' : 'Why this type: '}</span>
              {editing ? <Textarea value={p.summary[k] || ''} onChange={(e) => upd('summary', { ...p.summary, [k]: e.target.value })} /> : p.summary[k]}
            </div>
          ))}
          {Object.entries(p.summary.declineNotes || {}).map(([c, n]: any) => (
            <div key={c} className="rounded-lg border p-2 sm:col-span-2">
              <div className="font-semibold">{c} fell last month</div>
              <div><span className="text-muted-foreground">Why: </span>{n.whyFell}</div>
              <div><span className="text-muted-foreground">How this month fixes it: </span>{n.howFixed}</div>
            </div>
          ))}
          <div className="text-xs text-muted-foreground sm:col-span-2">Last month trend from the month-end report ({plan.reportRange}): {CHANNELS.map((c) => `${c} ${plan.lastMonthTrend?.[c] ?? 'DATA MISSING'}${typeof plan.lastMonthTrend?.[c] === 'number' ? '%' : ''}`).join(', ')}</div>
        </div>
      </Section>

      {/* 2 */}
      <Section title="2. What's included">
        <EditTable rows={p.included} editing={editing} onChange={(v) => upd('included', v)} cols={[{ key: 'item', label: 'Item', edit: 'text' }, { key: 'tags', label: 'Tag', edit: 'tags' }]} />
      </Section>

      {/* 3 */}
      <Section title="3. Keyword and topic plan" description="Priority score = (Business value x 3) + (Volume score x 2) + (Ease score x 2) + 5 if already ranking 11 to 20. One main keyword per blog, never repeated across months.">
        {s.seRanking && <TrackingLine t={s.seRanking} />}
        <EditTable
          rows={p.keywords}
          editing={editing}
          onChange={(v) => upd('keywords', v)}
          cols={[
            { key: 'keyword', label: 'Keyword', edit: 'text' },
            { key: 'intent', label: 'Intent', edit: 'text' },
            { key: 'volumeUs', label: 'Volume US', render: (r) => <M m={r.volumeUs} /> },
            { key: 'volumeIndia', label: 'Volume India', render: (r) => <M m={r.volumeIndia} /> },
            { key: 'difficulty', label: 'Difficulty', render: (r) => <M m={r.difficulty} /> },
            { key: 'currentPosition', label: 'Current position', render: (r) => <M m={r.currentPosition} /> },
            { key: 'serpFeature', label: 'SERP feature to win', edit: 'text' },
            { key: 'tags', label: 'Tag', edit: 'tags' },
            { key: 'businessValue', label: 'Business value', edit: 'number' },
            { key: 'score', label: 'Score' },
            { key: 'blogTitle', label: 'Blog title', edit: 'text' },
            { key: 'newOrRefresh', label: 'New or refresh', edit: 'text' },
          ]}
        />
      </Section>

      {/* 4 */}
      <Section title="4. Blog plan" description={`${p.blogPlan.newCount} new, ${p.blogPlan.refreshCount} refreshes. Posting days: ${(p.blogPlan.postingDays || []).join(', ')} at ${p.blogPlan.postingTime}. Each blog enters a 48-hour review before its slot.`}>
        <EditTable
          rows={p.blogPlan.calendar}
          editing={editing}
          onChange={(v) => upd('blogPlan', { ...p.blogPlan, calendar: v })}
          cols={[
            { key: 'publishDate', label: 'Publish date', render: (r) => fmtDate(r.publishDate) },
            { key: 'title', label: 'Title', edit: 'text' },
            { key: 'mainKeyword', label: 'Main keyword', edit: 'text' },
            { key: 'cluster', label: 'Cluster', edit: 'text' },
            { key: 'tags', label: 'Tag', edit: 'tags' },
            { key: 'reviewDeadline', label: 'Review deadline', render: (r) => fmtDate(r.reviewDeadline) },
            { key: 'status', label: 'Status' },
          ]}
        />
      </Section>

      {/* 5 */}
      <Section title="5. AEO and GEO plan" description="Snippets, People Also Ask boxes, AI Overview topics and AI chat citations targeted, and the pages that get direct-answer blocks, FAQ schema and comparison tables.">
        <EditTable
          rows={p.aeoGeo.items}
          editing={editing}
          onChange={(v) => upd('aeoGeo', { items: v })}
          cols={[
            { key: 'type', label: 'Type', edit: 'text' },
            { key: 'target', label: 'Target query or topic', edit: 'text' },
            { key: 'page', label: 'Page', edit: 'text' },
            { key: 'directAnswerBlock', label: 'Direct answer', render: (r) => (r.directAnswerBlock ? 'Yes' : 'No') },
            { key: 'faqSchema', label: 'FAQ schema', render: (r) => (r.faqSchema ? 'Yes' : 'No') },
            { key: 'comparisonTable', label: 'Comparison table', render: (r) => (r.comparisonTable ? 'Yes' : 'No') },
            { key: 'tags', label: 'Tag', edit: 'tags' },
          ]}
        />
      </Section>

      {/* 6 */}
      <Section title="6. Backlink plan" description="Safe methods only: SE Ranking backlink gap outreach, unlinked brand mentions, broken link replacement, directory and citation listings, automatic internal linking. Never paid links, link farms, comment spam or private blog networks. After approval the dashboard finds each site's contact email and adds it to the Smartlead outreach campaign on its date (up to 5 a day, no duplicates); Smartlead sends the emails and follow-ups. A task is marked done when SE Ranking finds the link. Directory listings need a person.">
        <EditTable
          rows={p.backlinks}
          editing={editing}
          onChange={(v) => upd('backlinks', v)}
          cols={[
            { key: 'targetSite', label: 'Target site', edit: 'text' },
            { key: 'method', label: 'Method', edit: 'text' },
            { key: 'ourPage', label: 'Our page', edit: 'text' },
            { key: 'sendDate', label: 'Send date', edit: 'text' },
            { key: 'status', label: 'Status' },
            { key: 'tags', label: 'Tag', edit: 'tags' },
          ]}
        />
      </Section>

      {/* 7 */}
      <Section title="7. Automation map">
        <DataTable head={['Platform', 'What runs automatically', 'When']}>
          {plan.automation.map((a: any, i: number) => (
            <tr key={i}><td className={TD}>{a.platform}</td><td className={TD}>{a.what}</td><td className={TD_MUTED}>{a.when}</td></tr>
          ))}
        </DataTable>
      </Section>

      {/* 8 */}
      <Section title="8. Technical and refresh plan" description={`${p.technical.crawl ? `From the Screaming Frog crawl uploaded ${fmtDate(p.technical.crawl.uploadedAt)} by ${p.technical.crawl.uploadedBy || 'unknown'}.` : 'DATA MISSING: Screaming Frog crawl. Upload one to fill this section.'} Every ticked fix is applied automatically through WordPress after approval, a few per run, with the old value saved for undo. To skip a fix, click Edit and untick it.`}>
        <EditTable rows={p.technical.fixes} editing={editing} onChange={(v) => upd('technical', { ...p.technical, fixes: v })} cols={[{ key: 'apply', label: 'Auto fix', edit: 'check', render: (r: any) => (r.apply === false ? 'Skipped' : FIX_LABEL[fixKindOf(r.issue)]) }, { key: 'url', label: 'URL', edit: 'text' }, { key: 'issue', label: 'Issue', edit: 'text' }, { key: 'fix', label: 'Fix', edit: 'text' }, { key: 'tags', label: 'Tag', edit: 'tags' }]} empty="No crawl fixes." />
        <div className="text-sm font-semibold">Refresh triggers</div>
        <EditTable rows={p.technical.refreshes} editing={editing} onChange={(v) => upd('technical', { ...p.technical, refreshes: v })} cols={[{ key: 'page', label: 'Page or keyword', edit: 'text' }, { key: 'trigger', label: 'Trigger' }, { key: 'source', label: 'Source' }, { key: 'tags', label: 'Tag', edit: 'tags' }]} empty="No page hit a refresh trigger." />
      </Section>

      {/* 9 */}
      <Section title="9. Monthly targets" description="Every SEO, AEO and GEO target must be higher than last month's actual. Organic leads are a signal only.">
        <EditTable
          rows={p.targets}
          editing={editing}
          onChange={(v) => upd('targets', v)}
          cols={[
            { key: 'channel', label: 'Channel' },
            { key: 'kpi', label: 'KPI' },
            { key: 'lastMonth', label: 'Last month', render: (r) => <M m={r.lastMonth} /> },
            { key: 'target', label: 'Target', edit: 'number', render: (r) => (r.channel === 'Signal' ? 'Signal only' : r.target ?? 'Not set') },
          ]}
        />
      </Section>

      {/* 10 */}
      <Section title="10. Automatic safeguards">
        <DataTable head={['Safeguard', 'Rule']}>
          {plan.safeguards.map((g: any) => (
            <tr key={g.name}><td className={TD}>{g.name}</td><td className={TD}>{g.rule}</td></tr>
          ))}
        </DataTable>
      </Section>

      {/* 11 */}
      <Section title="11. Action buttons">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm">{error}</div>}
        {s.blockers?.length > 0 && !approved && <ul className="ml-5 list-disc text-sm text-muted-foreground">{s.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>}
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {!canEdit && !canApprove && <p className="text-sm text-muted-foreground">You can view this strategy. Changing or approving it is done by a manager or admin.</p>}
        <div className={cn('flex flex-wrap gap-2', !canEdit && !canApprove && 'hidden')}>
          <Button variant="outline" disabled={!!busy || !canEdit} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' && <Loader2 className="animate-spin" />}Upload Screaming Frog file
          </Button>
          {!editing && canEdit && <Button variant="outline" disabled={!!busy} onClick={() => setEditing(true)}>Edit Strategy</Button>}
          {editing && (
            <>
              {approved && <Input className="h-8 w-72" placeholder="Why are you changing the approved strategy?" value={editWhy} onChange={(e) => setEditWhy(e.target.value)} />}
              <Button disabled={!!busy || (approved && !editWhy.trim())} onClick={saveEdits}>{busy === 'save' && <Loader2 className="animate-spin" />}Save edits</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          )}
          <Button variant="outline" disabled={editing || !!busy || !canEdit} onClick={updateLatest} title="Adds new automation steps, new backlink targets and fixes from a newer crawl. Does not rebuild the strategy.">
            {busy === 'update' && <Loader2 className="animate-spin" />}Update with latest changes
          </Button>
          <Button disabled={approved || editing || !!busy || s.blockers?.length > 0 || !canApprove} onClick={approve} title={canApprove ? undefined : 'Only an admin or a manager can approve'}>
            {busy === 'approve' && <Loader2 className="animate-spin" />}{approved ? 'Approved' : 'Approve Strategy'}
          </Button>
        </div>

        {updateResult && (
          <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <div className="font-semibold">{updateResult.changes.length ? 'Strategy updated' : 'No changes needed'} (AI cost {usd(updateResult.cost || 0)})</div>
            <ul className="ml-5 list-disc">
              {[...updateResult.changes, ...updateResult.notes].map((c: string) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}

        {approved && canEdit && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-sm font-semibold">Strategy change (mid-month)</div>
            <Input placeholder="What changed" value={change.what} onChange={(e) => setChange({ ...change, what: e.target.value })} />
            <Input placeholder="Why" value={change.why} onChange={(e) => setChange({ ...change, why: e.target.value })} />
            <Button size="sm" disabled={!!busy || !change.what || !change.why} onClick={logChange}>Log strategy change</Button>
            {s.changes?.length > 0 && (
              <DataTable head={['Date', 'What changed', 'Why', 'Approved by']}>
                {s.changes.map((c: any) => (
                  <tr key={c.id}><td className={TD_MUTED}>{fmtDate(c.created_at)}</td><td className={TD}>{c.what}</td><td className={TD}>{c.why}</td><td className={TD}>{c.approved_by}</td></tr>
                ))}
              </DataTable>
            )}
          </div>
        )}
      </Section>

      {s.edits?.length > 0 && (
        <Section title="Edit audit log">
          <DataTable head={['Date', 'Reviewer', 'Section', 'Old value', 'New value']}>
            {s.edits.map((e: any) => (
              <tr key={e.id}>
                <td className={TD_MUTED}>{fmtDate(e.created_at)}</td>
                <td className={TD}>{e.reviewer}</td>
                <td className={TD}>{e.section}</td>
                <td className={TD}><pre className="max-h-32 max-w-xs overflow-auto text-[11px] whitespace-pre-wrap">{e.old_value}</pre></td>
                <td className={TD}><pre className="max-h-32 max-w-xs overflow-auto text-[11px] whitespace-pre-wrap">{e.new_value}</pre></td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}

// The approved month's live blog calendar: fact check, 48-hour review (approve or reject with
// feedback), auto-publish time, rewrite notes and the author each blog went out under.
// SE Ranking tracking of this strategy's keywords (synced automatically on approval, edits,
// refresh and when the page opens).
function TrackingLine({ t }: { t: any }) {
  if (t.notConnected) return <p className="mb-2 text-xs text-muted-foreground">SE Ranking is not connected, so these keywords are not tracked yet.</p>;
  if (t.strategyKeywords === undefined) return <p className="mb-2 text-xs text-muted-foreground">Adding this strategy&apos;s keywords to SE Ranking tracking now. Refresh the page in a minute.</p>;
  if (t.error) return <p className="mb-2 text-xs text-muted-foreground">SE Ranking tracking could not be checked: {t.error}</p>;
  const all = t.trackedOfStrategy === t.strategyKeywords;
  return (
    <p className={`mb-2 rounded-md border p-2 text-xs ${all ? '' : 'border-amber-500/40 bg-amber-500/10'}`}>
      <span className="font-medium">SE Ranking tracking: </span>
      {t.trackedOfStrategy} of {t.strategyKeywords} strategy keywords are tracked. The project tracks {t.totalTracked} keywords in total (most {t.cap}, keeping 500 free). Checked {fmtDate(String(t.checkedAt).slice(0, 19).replace('T', ' '))}.
      {!all && t.missing?.length > 0 && <> Not tracked yet: {t.missing.join(', ')}.</>}
      {t.syncing && <> Updating now.</>}
    </p>
  );
}

function MonthRunning() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState<Record<number, string>>({});
  const canReview = useRole().can('strategy.approve');
  const load = useCallback(async () => {
    setData(await fetch('/api/strategy/schedule').then((r) => r.json()).catch(() => null));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function decide(id: number, action: 'approve' | 'reject') {
    setBusy(id);
    const res = await fetch(`/api/strategy/schedule/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, feedback, reviewer: reviewer[id] || '' }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(json.error || 'Could not save.');
    setMsg(action === 'approve' ? 'Approved. It publishes at its slot.' : 'Rejected. It will be rewritten with your feedback and come back to you for review, with a note on what changed.');
    setRejecting(null);
    setFeedback('');
    load();
  }

  const factCheck = (r: any) => {
    const fc = r.fact_check;
    if (!fc) return <span className="text-muted-foreground">Not checked yet</span>;
    if (!('ok' in fc)) return <span className="text-muted-foreground">Writer&apos;s check clean; the review&apos;s check runs when the review opens</span>;
    return fc.ok ? (
      <span>Verified ({fc.rounds} rounds{fc.corrected ? ', corrections applied' : ''})</span>
    ) : (
      <span className="font-medium text-red-600 dark:text-red-400">Could not verify every claim ({fc.rounds} rounds). Held.</span>
    );
  };
  const STATUS: Record<string, string> = { planned: 'Planned', drafting: 'Being written', in_review: 'In review', rejected: 'Rejected, rewrite queued', revising: 'Being rewritten', held: 'Held', published: 'Published', failed: 'Failed' };

  if (!data?.rows?.length) return null;
  const overdue = data.rows.filter((r: any) => r.overdue);
  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg border p-2 text-sm">{msg}</div>}
      {overdue.length > 0 && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-400">
          {overdue.length} blog{overdue.length === 1 ? ' has' : 's have'} waited more than 48 hours for review: {overdue.map((r: any) => r.title).join('; ')}. A reminder goes out every 12 hours until someone decides.
        </div>
      )}
      <Section
        title="This month's blogs"
        description="Every blog is fact-checked against official sources by two different AI models. A manager then has 48 hours to approve or reject it. If nobody rejects it, it is approved and published automatically under one of the partners' names, with its image and a call to action for its service. A rejected blog is rewritten with the feedback and comes back for review with a note on what changed. A blog that cannot be fully verified is never published."
      >
        <DataTable head={['Slot', 'Title', 'Fact check', 'Status', 'Review', '']}>
          {data.rows.map((r: any) => (
            <tr key={r.id} className={r.overdue ? 'bg-red-500/10' : undefined}>
              <td className={TD_MUTED}>{fmtDate(r.publish_at)}{r.overdue && <div className="font-semibold text-red-600 dark:text-red-400">Review overdue</div>}</td>
              <td className={TD}>
                {r.wp_post_url ? <a className="underline" href={r.wp_post_url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                {r.author && <div className="text-xs text-muted-foreground">By {r.author}{r.expert_reviewer ? `, reviewed by ${r.expert_reviewer}` : ''}</div>}
                {r.draft_id && (
                  <a className="text-xs text-primary underline" href={`/api/drafts/${r.draft_id}/download`} download>
                    Download as Word
                  </a>
                )}
                {r.cta && <div className="text-xs text-muted-foreground">Call to action: {r.cta.service}</div>}
              </td>
              <td className={TD}>{factCheck(r)}</td>
              <td className={TD}>
                {STATUS[r.status] || r.status}
                {r.approval_mode ? ` (${r.approval_mode === 'auto' ? 'auto-approved' : `approved by ${r.reviewed_by || 'reviewer'}`})` : ''}
                {r.hold_reasons?.length > 0 && <ul className="ml-4 list-disc text-xs">{r.hold_reasons.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>}
              </td>
              <td className={TD}>
                {r.status === 'in_review' && (
                  <div className="space-y-1 text-xs">
                    {r.reviewed_at ? (
                      <div>Approved by {r.reviewed_by}</div>
                    ) : r.needs_expert ? (
                      <div className="font-medium text-amber-700 dark:text-amber-400">Tax, legal or compliance topic: waits for a CA/CPA to approve it. It never publishes on its own.</div>
                    ) : (
                      r.auto_publish_at && <div className="text-muted-foreground">Auto-publishes {fmtDate(r.auto_publish_at.slice(0, 19).replace('T', ' '))} if nobody rejects it</div>
                    )}
                    {r.revision_note?.length > 0 && (
                      <details open>
                        <summary className="cursor-pointer font-medium">Rewrite {r.revisions}: what you asked and what changed</summary>
                        <ul className="mt-1 ml-4 list-disc">
                          {r.revision_note.map((n: any, i: number) => <li key={i}><span className="text-muted-foreground">Asked:</span> {n.asked} <br /><span className="text-muted-foreground">Changed:</span> {n.changed}</li>)}
                        </ul>
                      </details>
                    )}
                    <Link className="underline" href="/?tab=drafts">Read the draft in Drafts &amp; Review</Link>
                  </div>
                )}
                {r.status === 'rejected' && r.reject_feedback && <div className="text-xs text-muted-foreground">Feedback from {r.rejected_by}: {r.reject_feedback}</div>}
              </td>
              <td className={TD}>
                {canReview && ['in_review', 'held'].includes(r.status) && r.draft_id && !r.reviewed_at && (
                  <div className="flex flex-col gap-1">
                    {r.needs_expert && (
                      <select className="h-8 w-52 rounded-md border bg-background px-1 text-xs" value={reviewer[r.id] || ''} onChange={(e) => setReviewer((m) => ({ ...m, [r.id]: e.target.value }))} aria-label="CA/CPA reviewer">
                        <option value="">Reviewed by (CA/CPA)...</option>
                        {(data.reviewers || []).map((n: string) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    )}
                    {r.needs_expert && !(data.reviewers || []).length && <span className="w-52 text-xs text-muted-foreground">Add CA/CPA reviewers in Settings &gt; Blog rules first.</span>}
                    <Button size="sm" disabled={busy === r.id || (r.needs_expert && !reviewer[r.id])} onClick={() => decide(r.id, 'approve')}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => setRejecting(rejecting === r.id ? null : r.id)}>Reject</Button>
                  </div>
                )}
                {rejecting === r.id && (
                  <div className="mt-2 w-64 space-y-1">
                    <textarea className="w-full rounded-md border bg-background p-2 text-xs" rows={4} placeholder="Why are you rejecting it? What should change?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                    <Button size="sm" variant="destructive" disabled={busy === r.id || feedback.trim().length < 10} onClick={() => decide(r.id, 'reject')}>Reject and rewrite</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}

export default function StrategyTab({ active = true }: { active?: boolean }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await fetch('/api/strategy').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setList(rows);
    setOpenId((id) => id ?? rows.find((r: any) => r.status !== 'superseded')?.id ?? null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) load();
  }, [active, load]);

  // While a strategy is generating in the background, refresh every 3 seconds for its progress.
  const generating = list.find((s) => ['generating', 'paused', 'stopping'].includes(s.status));
  const paused = generating?.status === 'paused';

  // Pause, resume or stop the generation that is running.
  async function control(action: 'pause' | 'resume' | 'stop') {
    if (!generating) return;
    if (action === 'stop' && !window.confirm('Stop generating this strategy? You can start a new one any time.')) return;
    setError(null);
    const res = await fetch(`/api/strategy/${generating.id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error || `HTTP ${res.status}`);
    load();
  }
  useEffect(() => {
    if (!active || !generating) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, generating, load]);

  // Starts generation on the server and returns at once; nothing depends on this request staying open.
  async function generate() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch('/api/strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOpenId(json.id);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  const current = list.find((s) => s.id === openId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Monthly SEO, AEO and GEO Strategy</h2>
        {list.length > 0 && (
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={openId ?? ''} onChange={(e) => setOpenId(Number(e.target.value))}>
            {list.map((s) => <option key={s.id} value={s.id}>{s.period} ({s.status.replace('_', ' ')}, v{s.version})</option>)}
          </select>
        )}
        <Button variant="outline" disabled={starting || !!generating} onClick={generate}>
          {(starting || generating) && <Loader2 className="animate-spin" />}
          {generating ? (paused ? 'Paused' : 'Generating...') : 'Generate strategy (next 30 days)'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Each strategy covers 30 days from the day it is generated. A new one is generated automatically when the current one has 3 days left. Uses only real dashboard numbers. Generation runs on the server, so you can leave this page; progress also shows at the top of every tab.</p>
      {generating && (
        <div className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Loader2 className={`size-4 ${paused ? '' : 'animate-spin'}`} />
            <span className="font-medium">{paused ? 'Paused:' : generating.status === 'stopping' ? 'Stopping:' : 'Generating'} the strategy for {generating.period}</span>
            <span className="text-muted-foreground">{paused ? 'Waiting for you to resume' : generating.progress?.stage}</span>
            <span className="ml-auto tabular-nums">{generating.progress?.percent ?? 0}%</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {generating.status === 'generating' && <Button size="sm" variant="outline" onClick={() => control('pause')}>Pause</Button>}
            {paused && <Button size="sm" onClick={() => control('resume')}>Resume</Button>}
            {generating.status !== 'stopping' && <Button size="sm" variant="destructive" onClick={() => control('stop')}>Stop</Button>}
            <span className="self-center text-xs text-muted-foreground">Pause takes effect at the next step; Stop cancels at once.</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.max(2, generating.progress?.percent ?? 0)}%` }} />
          </div>
        </div>
      )}
      {current?.status === 'stopped' && (
        <div className="rounded-lg border p-3 text-sm">Generation of the strategy for {current.period} was stopped. Click Generate to start a new one.</div>
      )}
      {current?.status === 'failed' && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <div className="font-semibold">Generating the {current.period} strategy failed</div>
          <div>{current.error}</div>
          <div className="mt-1 text-muted-foreground">Fix the cause if it names a missing setting or key, then click Generate again.</div>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm">{error}</div>}
      {current?.plan ? (
        <StrategyView key={current.id} s={current} onChanged={(v) => setList((l) => l.map((x) => (x.id === v.id ? v : x)))} />
      ) : (
        <>
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-bold">
            ACTION REQUIRED BEFORE APPROVAL: Upload the latest Screaming Frog crawl export (full links list) to the dashboard. The strategy cannot be approved without it.
          </div>
          <label className="block text-sm">
            Screaming Frog crawl export (CSV or XLSX):{' '}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                const res = await fetch('/api/strategy/crawl', { method: 'POST', body: fd });
                const j = await res.json().catch(() => ({}));
                setError(res.ok ? null : j.error || 'Upload failed');
                load();
              }}
            />
          </label>
          <p className="text-sm text-muted-foreground">No strategy yet. Generate one, or wait for the monthly run.</p>
        </>
      )}
      <MonthRunning />
    </div>
  );
}

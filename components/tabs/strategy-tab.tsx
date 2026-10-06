'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';

// Strategy section (v2): one monthly SEO / AEO / GEO strategy in 11 fixed sections, one approval,
// then the month runs automatically. All UI text avoids em dashes by design.

type Col = { key: string; label: string; edit?: 'text' | 'number' | 'tags'; render?: (row: any) => ReactNode };

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
              {editing && c.edit === 'tags' ? (
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

export function StrategyView({ s, onChanged }: { s: any; onChanged: (v: any) => void }) {
  const plan = s.plan;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(plan);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState({ what: '', why: '' });
  const [editWhy, setEditWhy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const approved = s.status === 'approved';
  const p = editing ? draft : plan;

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
      <Section title="4. Blog plan" description={`${p.blogPlan.newCount} new, ${p.blogPlan.refreshCount} refreshes. Posting days: ${(p.blogPlan.postingDays || []).join(', ')} at ${p.blogPlan.postingTime}. Each blog enters review 24 hours before its slot.`}>
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
      <Section title="6. Backlink plan" description="Safe methods only: SE Ranking backlink gap outreach, unlinked brand mentions, broken link replacement, directory and citation listings, automatic internal linking. Never paid links, link farms, comment spam or private blog networks.">
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
      <Section title="8. Technical and refresh plan" description={p.technical.crawl ? `From the Screaming Frog crawl uploaded ${fmtDate(p.technical.crawl.uploadedAt)} by ${p.technical.crawl.uploadedBy || 'unknown'}.` : 'DATA MISSING: Screaming Frog crawl. Upload one to fill this section.'}>
        <EditTable rows={p.technical.fixes} editing={editing} onChange={(v) => upd('technical', { ...p.technical, fixes: v })} cols={[{ key: 'url', label: 'URL', edit: 'text' }, { key: 'issue', label: 'Issue', edit: 'text' }, { key: 'fix', label: 'Fix', edit: 'text' }, { key: 'tags', label: 'Tag', edit: 'tags' }]} empty="No crawl fixes." />
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' && <Loader2 className="animate-spin" />}Upload Screaming Frog file
          </Button>
          {!editing && <Button variant="outline" disabled={!!busy} onClick={() => setEditing(true)}>Edit Strategy</Button>}
          {editing && (
            <>
              {approved && <Input className="h-8 w-72" placeholder="Why are you changing the approved strategy?" value={editWhy} onChange={(e) => setEditWhy(e.target.value)} />}
              <Button disabled={!!busy || (approved && !editWhy.trim())} onClick={saveEdits}>{busy === 'save' && <Loader2 className="animate-spin" />}Save edits</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          )}
          <Button disabled={approved || editing || !!busy || s.blockers?.length > 0} onClick={approve}>
            {busy === 'approve' && <Loader2 className="animate-spin" />}{approved ? 'Approved' : 'Approve Strategy'}
          </Button>
        </div>

        {approved && (
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

// The approved month's live blog calendar, with each blog's automatic fact-check result.
function MonthRunning() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    setData(await fetch('/api/strategy/schedule').then((r) => r.json()).catch(() => null));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function markReviewed(id: number) {
    const res = await fetch(`/api/strategy/schedule/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reviewed' }) });
    setMsg(res.ok ? 'Marked as reviewed. The reviewed version publishes at its slot.' : 'Could not mark as reviewed.');
    load();
  }

  const factCheck = (r: any) => {
    const fc = r.fact_check;
    if (!fc) return <span className="text-muted-foreground">Not checked yet</span>;
    return fc.ok ? (
      <span>Verified ({fc.rounds} rounds{fc.corrected ? ', corrections applied' : ''})</span>
    ) : (
      <span className="font-medium text-red-600 dark:text-red-400">Could not verify every claim ({fc.rounds} rounds). Held.</span>
    );
  };

  if (!data?.rows?.length) return null;
  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg border p-2 text-sm">{msg}</div>}
      <Section
        title="This month's blogs"
        description="Every blog is fact-checked against official sources automatically: wrong claims are corrected and the blog is checked again until two checks in a row are clean. Blogs enter review 24 hours before their slot; unreviewed blogs are auto-approved and published on schedule. A blog that cannot be fully verified is never published."
      >
        <DataTable head={['Slot', 'Title', 'Fact check', 'Status', 'Held because', '']}>
          {data.rows.map((r: any) => (
            <tr key={r.id}>
              <td className={TD_MUTED}>{fmtDate(r.publish_at)}</td>
              <td className={TD}>{r.wp_post_url ? <a className="underline" href={r.wp_post_url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}</td>
              <td className={TD}>{factCheck(r)}</td>
              <td className={TD}>{r.status}{r.approval_mode ? ` (${r.approval_mode === 'auto' ? 'auto-approved' : `reviewed by ${r.reviewed_by || 'reviewer'}`})` : ''}</td>
              <td className={TD}>{r.hold_reasons?.length ? <ul className="ml-4 list-disc text-xs">{r.hold_reasons.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul> : ''}</td>
              <td className={TD}>{r.status === 'in_review' && !r.reviewed_at && <Button size="sm" variant="outline" onClick={() => markReviewed(r.id)}>Mark reviewed</Button>}</td>
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

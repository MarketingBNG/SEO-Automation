'use client';

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Download, FileSearch, Loader2, Wand2, X } from 'lucide-react';
import { useRole } from '@/hooks/use-role';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SafeHtml, asList, decodeEntities, safeHref } from '@/components/shared/article';
import {
  ActionMessage, DataTable, NativeSelect, PeopleAlsoAskList, SectionLabel, StatusBadge,
} from '@/components/shared/ui-bits';

export function rewriteBadgeClass(status: string) {
  if (status === 'published') return 'published';
  if (status === 'sent_as_draft') return 'drafted';
  if (status === 'generating') return 'generating';
  return 'approved';
}

export const severityBadge = (severity: string) =>
  severity === 'critical' ? 'failed' : severity === 'moderate' ? 'generating' : 'pending';

const previewBox = 'mt-1 max-h-[150px] overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm';

// The rewrite's own checks (the same validation new drafts get): production state, what is still
// wrong after auto-repair, reviewer notes and the claims to verify. Used by both rewrite panels.
export function RewriteChecks({ audit }: { audit: any }) {
  const state = audit.rewrite_production_state;
  const issues = asList(audit.rewrite_validation_issues);
  const warnings = asList(audit.rewrite_validation_warnings);
  const facts = asList(audit.rewrite_facts);
  return (
    <>
      {state && (
        <div className="mt-2.5 flex">
          <StatusBadge kind={state === 'READY_FOR_REVIEW' ? 'approved' : 'failed'}>{state.replace(/_/g, ' ')}</StatusBadge>
        </div>
      )}
      {state === 'NEEDS_ATTENTION' && (
        <div className="mt-2">
          <div className="text-sm text-muted-foreground">Unresolved issues after auto-repair (rewrite again, or fix them before this goes on the site):</div>
          <div className={previewBox}>
            {issues.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {issues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            ) : (
              <span className="text-muted-foreground">The checks did not list the issues. Review the rewrite by hand.</span>
            )}
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2">
          <div className="text-sm text-muted-foreground">Reviewer notes (not blocking, worth a look before approving):</div>
          <div className={previewBox}>
            <ul className="list-disc space-y-0.5 pl-5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-sm text-muted-foreground">Facts Register: check each hard claim in the rewrite before approving:</div>
          <DataTable
            rows={facts}
            cols={[
              { key: 'claim', label: 'Claim' },
              {
                key: 'source',
                label: 'Source',
                muted: true,
                render: (f) =>
                  safeHref(f.source_url) ? (
                    <a href={safeHref(f.source_url)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                      {f.source_name || f.source_url}
                    </a>
                  ) : (
                    f.source_name || <span className="text-destructive">no source</span>
                  ),
              },
              { key: 'jurisdiction', label: 'Jurisdiction', muted: true },
            ]}
          />
        </div>
      )}
    </>
  );
}

// Sends an audit's rewrite to WordPress and returns { text, link } describing what happened, or
// null when the user cancels. Replacing a live post asks first, and a rewrite that failed its
// checks is only sent after an explicit OK (the server answers 409 needsOverride).
export async function publishAuditRewrite(audit: any, wpStatus: string) {
  const existing = Boolean(audit.wp_post_id);
  if (
    existing &&
    wpStatus === 'publish' &&
    !window.confirm(
      `Replace the live post${audit.wp_post_url ? ` at ${audit.wp_post_url}` : ''} with this rewrite now? Visitors and Google see the new version straight away.`
    )
  ) {
    return null;
  }
  const send = (override: boolean) =>
    fetch(`/api/audit/${audit.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override ? { wpStatus, override: true } : { wpStatus }),
    });
  let res = await send(false);
  let json = await res.json().catch(() => ({}));
  if (res.status === 409 && json.needsOverride) {
    const count = asList(audit.rewrite_validation_issues).length;
    const what = count ? `${count} unresolved issue${count === 1 ? '' : 's'}` : 'unresolved issues';
    if (!window.confirm(`This rewrite still has ${what} after auto-repair. Send it to WordPress anyway?`)) return null;
    res = await send(true);
    json = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  if (json.draft) return { text: 'Saved as a separate WordPress draft. The live post has not changed:', link: json.draft.link };
  if (existing) return { text: 'Replaced the live post:', link: json.wpPostUrl || audit.wp_post_url };
  return { text: wpStatus === 'publish' ? 'Published as a new post:' : 'Sent to WordPress as a draft:', link: json.wpPostUrl };
}

const linkCls = 'text-primary underline underline-offset-4 break-all';

// Rewrite again / send to WordPress, shared by Blog Audit and Blog Renewal. For a post that is
// already live the default is a separate WordPress draft, so the live post stays as it is until
// someone picks "Replace the live post now". Render with key={audit.id} so the choice resets.
export function RewritePublishControls({ audit, busy, onRewrite, onPublish }: { audit: any; busy: any; onRewrite: () => void; onPublish: (s: string) => void }) {
  const [wpStatus, setWpStatus] = useState('draft');
  const existing = Boolean(audit.wp_post_id);
  const liveLink = safeHref(audit.wp_post_url);

  if (audit.rewrite_status === 'published') {
    return <p className="text-sm text-muted-foreground">{existing ? 'Already replaced live.' : 'Already sent to WordPress.'}</p>;
  }

  const rewriteButton = (
    <Button variant="outline" onClick={onRewrite} disabled={Boolean(busy)}>
      {busy === 'rewrite' ? <Loader2 className="animate-spin" /> : <Wand2 />}
      {busy === 'rewrite' ? 'Rewriting… (can take 1-2 min)' : 'Rewrite again'}
    </Button>
  );

  if (audit.wp_post_type === 'page') {
    return (
      <>
        <div className="mt-2.5 flex flex-wrap gap-2">{rewriteButton}</div>
        <p className="mt-2 text-sm text-muted-foreground">This is a WPBakery page. Apply the changes with the Assistant so the layout is kept.</p>
      </>
    );
  }

  if (existing && audit.rewrite_status === 'sent_as_draft') {
    const draftLink = safeHref(audit.rewrite_wp_draft_url);
    return (
      <>
        <p className="mt-2 text-sm text-muted-foreground">
          Saved as a separate WordPress draft
          {draftLink && (
            <>
              {': '}
              <a href={draftLink} target="_blank" rel="noreferrer" className={linkCls}>{audit.rewrite_wp_draft_url}</a>
            </>
          )}
          . The live post has not changed.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {rewriteButton}
          <Button onClick={() => onPublish('publish')} disabled={Boolean(busy)}>
            {busy === 'publish' ? 'Working…' : 'Replace the live post now'}
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This uses the rewrite shown here. Edits made to the WordPress draft are not copied back to the dashboard.
        </p>
      </>
    );
  }

  const approveLabel = existing
    ? wpStatus === 'draft'
      ? 'Approve - save as WordPress draft'
      : 'Approve - replace the live post'
    : wpStatus === 'draft'
    ? 'Approve - send to WordPress as draft'
    : 'Approve - publish as new post';

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {rewriteButton}
        <NativeSelect value={wpStatus} onChange={(e) => setWpStatus(e.target.value)}>
          <option value="draft">{existing ? 'Save as a separate WordPress draft (live post unchanged)' : 'Send to WordPress as Draft'}</option>
          <option value="publish">{existing ? 'Replace the live post now' : 'Publish live now'}</option>
        </NativeSelect>
        <Button onClick={() => onPublish(wpStatus)} disabled={Boolean(busy)}>
          {busy === 'publish' ? 'Working…' : approveLabel}
        </Button>
      </div>
      {existing && (
        <p className="mt-2 text-sm text-muted-foreground">
          {wpStatus === 'draft' ? 'A new draft post is made in WordPress for review. The live post at ' : 'This will replace the live post at '}
          {liveLink ? (
            <a href={liveLink} target="_blank" rel="noreferrer" className={linkCls}>{audit.wp_post_url}</a>
          ) : (
            'its current address'
          )}
          {wpStatus === 'draft' ? ' stays as it is.' : '.'}
        </p>
      )}
    </>
  );
}

export function IssuesTable({ issues }: { issues: any[] }) {
  return (
    <DataTable
      rows={issues}
      cols={[
        { key: 'severity', label: 'Severity', render: (iss) => <StatusBadge kind={severityBadge(iss.severity)}>{iss.severity}</StatusBadge> },
        { key: 'category', label: 'Category', muted: true },
        { key: 'description', label: 'Description' },
      ]}
    />
  );
}

export function WhyTheseChanges({ issues, suggestions, suggestionsLabel }: { issues: any[]; suggestions: any[]; suggestionsLabel: string }) {
  return (
    <div className="mt-3 rounded-xl border bg-muted/40 p-4">
      <h3 className="font-heading text-base font-medium">Why these changes</h3>
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {issues.map((iss, i) => (
            <li key={i}>
              <StatusBadge kind={severityBadge(iss.severity)} className="mr-1.5">
                {iss.category}
              </StatusBadge>
              {iss.description}
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <>
          <div className="mt-2.5 text-sm text-muted-foreground">{suggestionsLabel}</div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

export default function AuditTab() {
  const canDownload = useRole().can('reports.download');
  const [mode, setMode] = useState('upload'); // 'upload' | 'paste' | 'url'
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [audits, setAudits] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [openId, setOpenId] = useState<any>(null);

  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch('/api/audit').then((r) => r.json()).catch(() => null);
    setAudits(Array.isArray(j) ? j : []);
    setLoadingList(false);
  }, []);

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/audit/extract', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTitle(json.title || '');
      setContentHtml(json.contentHtml || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runAudit() {
    setRunning(true);
    setError(null);
    try {
      const body = mode === 'url' ? { sourceUrl } : { title, contentHtml };
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setOpenId(json.id);
      setTitle('');
      setContentHtml('');
      setSourceUrl('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // Per audit, so opening another audit never shows this one's progress, result or error.
  const [busyAudits, setBusyAudits] = useState<Record<string, string>>({}); // audit id -> 'rewrite' | 'publish'
  const [auditMessages, setAuditMessages] = useState<Record<string, any>>({}); // audit id -> { text, link }

  const markBusy = (id: any, kind: string | null) =>
    setBusyAudits((prev) => {
      const next = { ...prev };
      if (kind) next[id] = kind;
      else delete next[id];
      return next;
    });
  const note = (id: any, message: any) => setAuditMessages((prev) => ({ ...prev, [id]: message }));

  async function doRewrite(id: any) {
    markBusy(id, 'rewrite');
    note(id, null);
    try {
      const res = await fetch(`/api/audit/${id}/rewrite`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      load();
    } catch (err: any) {
      note(id, { text: 'Error: ' + err.message });
    } finally {
      markBusy(id, null);
    }
  }

  async function doPublishRewrite(audit: any, wpStatus: string) {
    markBusy(audit.id, 'publish');
    note(audit.id, null);
    try {
      const result = await publishAuditRewrite(audit, wpStatus);
      note(audit.id, result || { text: 'Not sent. Nothing changed on WordPress.' });
      if (result) load();
    } catch (err: any) {
      note(audit.id, { text: 'Error: ' + err.message });
    } finally {
      markBusy(audit.id, null);
    }
  }

  const open = audits.find((a) => a.id === openId);
  const openBusy = open ? busyAudits[open.id] : null;
  const canRun = mode === 'url' ? sourceUrl.trim() : contentHtml.trim();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="size-4 text-muted-foreground" />
            Audit a blog
          </CardTitle>
          <CardDescription>
            Upload the full blog as a Word (.docx) file, and get a pass/fail check: accuracy
            (every hard claim verified), SEO/AEO structure, voice, and a clear call to action. Not
            just your own blogs, any blog. Pasting the content directly also works.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="upload">Upload .docx</option>
              <option value="paste">Paste content</option>
              <option value="url">Give a URL</option>
            </NativeSelect>
          </div>

          {mode === 'upload' && (
            <div className="space-y-1.5">
              <Input type="file" accept=".docx" onChange={handleFileUpload} disabled={uploading} className="max-w-md" />
              <p className="text-sm text-muted-foreground">
                For a Google Doc: File → Download → Microsoft Word (.docx), then upload that
                file here.
              </p>
              {uploading && <p className="text-sm text-muted-foreground">Reading file…</p>}
              {contentHtml && (
                <p className="text-sm text-muted-foreground">
                  Loaded{title ? ` "${title}"` : ''} ({contentHtml.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length} words). Ready to audit below.
                </p>
              )}
            </div>
          )}

          {mode === 'url' && (
            <div className="space-y-1.5">
              <SectionLabel>Blog URL</SectionLabel>
              <Input
                type="text"
                placeholder="https://usaindiacfo.com/some-post/"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
          )}

          {mode === 'paste' && (
            <div className="space-y-1.5">
              <SectionLabel>Paste the entire blog here</SectionLabel>
              <Textarea rows={12} value={contentHtml} onChange={(e) => setContentHtml(e.target.value)} />
            </div>
          )}

          <div>
            <Button onClick={runAudit} disabled={!canRun || running}>
              {running && <Loader2 className="animate-spin" />}
              {running ? 'Auditing… (can take 1-2 min)' : 'Run audit'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">Error: {error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past audits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Title / URL</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Audited</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map((a) => (
                  <TableRow key={a.id} data-state={a.id === openId ? 'selected' : undefined}>
                    <TableCell className="max-w-md whitespace-normal font-medium">{decodeEntities(a.title) || a.source_url || '(untitled)'}</TableCell>
                    <TableCell>
                      <StatusBadge kind={a.verdict === 'READY' ? 'approved' : 'failed'}>{a.verdict}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.issues.length}</TableCell>
                    <TableCell className="text-muted-foreground">{a.created_at}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setOpenId(a.id)}>Open</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {audits.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">{loadingList ? 'Loading…' : 'No audits yet.'}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle className="break-words">{decodeEntities(open.title) || open.source_url}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                <X /> Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex">
              <StatusBadge kind={open.verdict === 'READY' ? 'approved' : 'failed'}>{open.verdict}</StatusBadge>
            </div>
            <p className="text-sm">{open.summary}</p>

            {open.issues.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm text-muted-foreground">Issues found:</div>
                <IssuesTable issues={open.issues} />
              </div>
            )}

            {open.suggestions.length > 0 && (
              <div>
                <div className="text-sm text-muted-foreground">Suggested fixes:</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {open.suggestions.map((s: any, i: number) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            <PeopleAlsoAskList
              items={open.people_also_ask}
              label={'Google "People also ask" for this topic (✓ = the post\'s FAQ already answers it)'}
            />

            {open.facts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm text-muted-foreground">Fact check:</div>
                <DataTable
                  rows={open.facts}
                  cols={[
                    { key: 'claim', label: 'Claim' },
                    {
                      key: 'source',
                      label: 'Source',
                      muted: true,
                      render: (f) =>
                        safeHref(f.source_url) ? (
                          <a href={safeHref(f.source_url)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                            {f.source_name || f.source_url}
                          </a>
                        ) : (
                          f.source_name || f.source_url
                        ),
                    },
                    { key: 'verdict', label: 'Verdict', render: (f) => <StatusBadge kind={f.verdict === 'confirmed' ? 'approved' : 'failed'}>{f.verdict}</StatusBadge> },
                  ]}
                />
              </div>
            )}

            <Separator className="my-1" />

            {!open.content_html ? (
              <p className="text-sm text-muted-foreground">
                This audit has no saved content to rewrite from (an old audit from before this
                feature). Re-run the audit to enable rewriting.
              </p>
            ) : !open.rewrite_content_html ? (
              <div>
                <Button onClick={() => doRewrite(open.id)} disabled={Boolean(openBusy)}>
                  {openBusy === 'rewrite' ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  {openBusy === 'rewrite' ? 'Rewriting… (can take 1-2 min)' : 'Rewrite to fix these issues'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{open.rewrite_production_state === 'NEEDS_ATTENTION' ? 'Rewrite needs attention' : 'Rewrite ready for review'}</strong>
                  {open.rewrite_status && (
                    <StatusBadge kind={rewriteBadgeClass(open.rewrite_status)}>{open.rewrite_status.replace(/_/g, ' ')}</StatusBadge>
                  )}
                </div>

                <RewriteChecks audit={open} />

                {(open.issues.length > 0 || open.suggestions.length > 0) && (
                  <WhyTheseChanges issues={open.issues} suggestions={open.suggestions} suggestionsLabel="Fixes the rewrite was asked to make:" />
                )}

                <SectionLabel className="mt-2">Title</SectionLabel>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm font-medium">{decodeEntities(open.rewrite_title)}</div>
                <SectionLabel className="mt-2">Content preview</SectionLabel>
                <SafeHtml className="prose-article max-h-[420px] overflow-y-auto rounded-lg border bg-background p-4 text-sm" html={open.rewrite_content_html} />
                <PeopleAlsoAskList
                  items={open.rewrite_people_also_ask}
                  label={'Google "People also ask" questions (✓ = used in the rewritten FAQ)'}
                />
                <div className="mt-2.5">
                  {canDownload && (
                  <a href={`/api/audit/${open.id}/download`} className={buttonVariants({ variant: 'outline' })}>
                    <Download /> Download Word
                  </a>
                  )}
                </div>
                <RewritePublishControls
                  key={open.id}
                  audit={open}
                  busy={openBusy}
                  onRewrite={() => doRewrite(open.id)}
                  onPublish={(wpStatus) => doPublishRewrite(open, wpStatus)}
                />
              </div>
            )}
            <ActionMessage message={auditMessages[open.id]} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

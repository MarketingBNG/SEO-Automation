'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCcw, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BlogAnalytics } from '@/components/shared/blog-insights';
import { NativeSelect, PeopleAlsoAskList, SectionLabel, StatusBadge } from '@/components/shared/ui-bits';
import { IssuesTable, WhyTheseChanges } from '@/components/tabs/audit-tab';

export default function RenewalTab() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePostId, setActivePostId] = useState<any>(null);
  const [busyPostId, setBusyPostId] = useState<any>(null);
  const [audits, setAudits] = useState<Record<string, any>>({}); // audit id -> full audit row (with facts/issues parsed)
  const [publishWpStatus, setPublishWpStatus] = useState('draft');
  const [message, setMessage] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true);
    setError(null);
    try {
      const res = await fetch('/api/wordpress/posts');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPosts(json.posts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPosts();
  }, [loadPosts]);

  const loadAudit = useCallback(async (auditId: any) => {
    const res = await fetch('/api/audit');
    const all = await res.json();
    const a = all.find((x: any) => x.id === auditId);
    if (a) setAudits((prev) => ({ ...prev, [auditId]: a }));
    return a;
  }, []);
  // Audits and rewrites run on the server in the background; poll while the open one runs.
  const openAuditId = posts.find((p: any) => p.id === activePostId)?.audit?.id;
  const openAudit = openAuditId ? audits[openAuditId] : null;
  const openRunning = openAudit?.audit_status === 'running' || openAudit?.rewrite_status === 'generating';
  useEffect(() => {
    if (!openRunning || !openAuditId) return;
    const t = setInterval(async () => {
      const a = await loadAudit(openAuditId).catch(() => null);
      if (a && a.audit_status !== 'running' && a.rewrite_status !== 'generating') loadPosts();
    }, 5000);
    return () => clearInterval(t);
  }, [openRunning, openAuditId, loadAudit, loadPosts]);

  async function auditThisPost(post: any) {
    setBusyPostId(post.id);
    setMessage(null);
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpPostId: post.id }),
      });
      const json = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}). Try again.` }));
      if (!res.ok) throw new Error(json.error);
      setAudits((prev) => ({ ...prev, [json.id]: json }));
      setActivePostId(post.id);
      loadPosts();
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setBusyPostId(null);
    }
  }

  async function rewriteAudit(auditId: any) {
    setBusyPostId(activePostId);
    setMessage(null);
    try {
      const res = await fetch(`/api/audit/${auditId}/rewrite`, { method: 'POST' });
      const json = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}). Try again.` }));
      if (!res.ok) throw new Error(json.error);
      setAudits((prev) => ({ ...prev, [auditId]: json }));
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setBusyPostId(null);
    }
  }

  async function publishAudit(auditId: any) {
    setBusyPostId(activePostId);
    setMessage(null);
    try {
      const res = await fetch(`/api/audit/${auditId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpStatus: publishWpStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(`Replaced live post: ${json.wpPostUrl}`);
      await loadAudit(auditId);
      loadPosts();
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setBusyPostId(null);
    }
  }

  const activePost = posts.find((p) => p.id === activePostId);
  const activeAudit = activePost?.audit ? audits[activePost.audit.id] : null;
  const busyActive = busyPostId === activePostId;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Blog renewal</CardTitle>
          <CardDescription>
            Every published blog on the site, one at a time: audit it, review what needs fixing,
            rewrite it, and replace the live post only after you approve. Nothing goes live without
            you clicking approve.
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={loadPosts} disabled={loadingPosts}>
              {loadingPosts ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
              {loadingPosts ? 'Loading…' : 'Refresh list'}
            </Button>
          </CardAction>
        </CardHeader>
        {error && (
          <CardContent>
            <p className="text-sm text-destructive">Error: {error}</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Post</TableHead>
                  <TableHead>Last audit</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((p) => (
                  <TableRow key={p.id} data-state={p.id === activePostId ? 'selected' : undefined}>
                    <TableCell className="max-w-lg whitespace-normal">
                      <div className="font-medium">{p.title}</div>
                      <a className="text-xs break-all text-muted-foreground hover:underline" href={p.link} target="_blank" rel="noreferrer">
                        {p.link}
                      </a>
                    </TableCell>
                    <TableCell>
                      {p.audit ? (
                        <div className="flex flex-wrap gap-1">
                          {p.audit.audit_status === 'running' ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Auditing…</span>
                          ) : p.audit.audit_status === 'failed' ? (
                            <StatusBadge kind="failed">audit failed</StatusBadge>
                          ) : (
                            <StatusBadge kind={p.audit.verdict === 'READY' ? 'approved' : 'failed'}>{p.audit.verdict}</StatusBadge>
                          )}
                          {p.audit.rewrite_status && (
                            <StatusBadge kind={p.audit.rewrite_status === 'published' ? 'published' : 'approved'}>{p.audit.rewrite_status}</StatusBadge>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">not audited yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => auditThisPost(p)} disabled={busyPostId === p.id}>
                          {busyPostId === p.id && <Loader2 className="animate-spin" />}
                          {busyPostId === p.id ? 'Working…' : p.audit ? 'Re-audit' : 'Audit'}
                        </Button>
                        {p.audit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              setActivePostId(p.id);
                              await loadAudit(p.audit.id);
                            }}
                          >
                            Review
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {posts.length === 0 && !loadingPosts && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">No posts found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {activePost && activeAudit && (
        <Card>
          <CardHeader>
            <CardTitle className="break-words">{activePost.title}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setActivePostId(null)}>
                <X /> Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex">
              <StatusBadge kind={activeAudit.verdict === 'READY' ? 'approved' : 'failed'}>{activeAudit.verdict}</StatusBadge>
            </div>
            <p className="text-sm">{activeAudit.summary}</p>

            <BlogAnalytics key={activePost.link} url={activePost.link} title="" />

            {activeAudit.issues.length > 0 && <IssuesTable issues={activeAudit.issues} />}

            <PeopleAlsoAskList
              items={activeAudit.people_also_ask}
              label={'Google "People also ask" for this topic (✓ = the post\'s FAQ already answers it)'}
            />

            <Separator className="my-1" />

            {activeAudit.audit_status === 'running' ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Auditing this post on the server (usually a few minutes). You can leave this page.</p>
            ) : activeAudit.audit_status === 'failed' ? (
              <p className="text-sm text-destructive">The audit failed: {activeAudit.audit_error || 'unknown error'}. Press Re-audit.</p>
            ) : activeAudit.rewrite_status === 'generating' ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Rewriting on the server (usually 2 to 5 minutes). You can leave this page.</p>
            ) : !activeAudit.rewrite_content_html ? (
              <div className="space-y-1">
                {activeAudit.rewrite_error && <p className="text-sm text-destructive">The last rewrite failed: {activeAudit.rewrite_error}</p>}
                <Button onClick={() => rewriteAudit(activeAudit.id)} disabled={busyActive}>
                  {busyActive && <Loader2 className="animate-spin" />}
                  {activeAudit.rewrite_error ? 'Try the rewrite again' : 'Rewrite to fix these issues'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(activeAudit.issues.length > 0 || activeAudit.suggestions.length > 0) && (
                  <WhyTheseChanges issues={activeAudit.issues} suggestions={activeAudit.suggestions} suggestionsLabel="Fixes applied:" />
                )}
                <SectionLabel className="mt-2">Rewritten title</SectionLabel>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm font-medium">{activeAudit.rewrite_title}</div>
                <SectionLabel className="mt-2">Rewritten content preview</SectionLabel>
                {/* PORT NOTE: rendered unsanitized exactly as the old Blog Renewal tab did. */}
                <div
                  className="prose-article max-h-[420px] overflow-y-auto rounded-lg border bg-background p-4 text-sm"
                  dangerouslySetInnerHTML={{ __html: activeAudit.rewrite_content_html }}
                />
                <PeopleAlsoAskList
                  items={activeAudit.rewrite_people_also_ask}
                  label={'Google "People also ask" questions (✓ = used in the rewritten FAQ)'}
                />
                <div className="mt-2.5">
                  <a href={`/api/audit/${activeAudit.id}/download`} className={buttonVariants({ variant: 'outline' })}>
                    <Download /> Download Word
                  </a>
                </div>
                {activeAudit.rewrite_status !== 'published' ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => rewriteAudit(activeAudit.id)} disabled={busyActive}>
                      Rewrite again
                    </Button>
                    <NativeSelect value={publishWpStatus} onChange={(e) => setPublishWpStatus(e.target.value)}>
                      <option value="draft">Replace as Draft (review on WP first)</option>
                      <option value="publish">Replace live now</option>
                    </NativeSelect>
                    <Button onClick={() => publishAudit(activeAudit.id)} disabled={busyActive}>
                      {busyActive ? 'Working…' : 'Approve – replace the live post'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Already replaced live.</p>
                )}
              </div>
            )}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

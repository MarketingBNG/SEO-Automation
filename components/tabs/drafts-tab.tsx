'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, FolderOpen, Loader2, Save, Send, ThumbsDown, ThumbsUp, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { SafeHtml, safeHref } from '@/components/shared/article';
import { BlogAnalytics, BlogTable, KeywordPanel } from '@/components/shared/blog-insights';
import { StatusBadge } from '@/components/shared/status-badge';
import { PeopleAlsoAskList } from '@/components/shared/people-also-ask';
import { DataTable, FieldLabel, NativeSelect, TD, TD_MUTED } from '@/components/shared/content-ui';

export { PeopleAlsoAskList };

const PREVIEW_BOX = 'overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm';

export default function DraftsTab() {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [openId, setOpenId] = useState<any>(null);
  const [analyticsPost, setAnalyticsPost] = useState<any>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/drafts/list');
    setDrafts(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <DataTable head={['Title / Keyword', 'Production', 'Status', 'Words', 'Updated', '']}>
            {drafts.map((d) => (
              <tr key={d.id}>
                <td className={TD}>
                  <div className="font-medium">{d.title || <span className="font-normal text-muted-foreground">(untitled)</span>}</div>
                  <div className="text-xs text-muted-foreground">{d.keyword}</div>
                </td>
                <td className={TD}>
                  {d.production_state && (
                    <StatusBadge status={d.production_state === 'READY_FOR_REVIEW' ? 'approved' : 'failed'}>
                      {d.production_state.replace(/_/g, ' ')}
                    </StatusBadge>
                  )}
                </td>
                <td className={TD}>
                  <StatusBadge status={d.status}>{d.status.replace('_', ' ')}</StatusBadge>
                </td>
                <td className={`${TD_MUTED} tabular-nums`}>{d.word_count || '-'}</td>
                <td className={`${TD_MUTED} whitespace-nowrap`}>{d.updated_at}</td>
                <td className={TD}>
                  <Button variant="outline" size="sm" onClick={() => setOpenId(d.id)}>
                    <FolderOpen />
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {drafts.length === 0 && (
              <tr>
                <td colSpan={6} className={TD_MUTED}>No drafts yet. Generate one from the Keywords tab.</td>
              </tr>
            )}
          </DataTable>
        </CardContent>
      </Card>

      {openId && (
        <DraftEditor
          draftId={openId}
          onClose={() => setOpenId(null)}
          onChange={load}
        />
      )}

      <BlogTable onOpen={(r) => setAnalyticsPost(r)} />
      {analyticsPost && (
        <Card>
          <CardHeader>
            <CardTitle>{analyticsPost.title}</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setAnalyticsPost(null)}>
                <X />
                Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <BlogAnalytics key={analyticsPost.url} url={analyticsPost.url} title="" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NoteList({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm text-muted-foreground">{heading}</div>
      <div className={PREVIEW_BOX} style={{ maxHeight: 150 }}>
        <ul className="m-0 list-disc pl-[18px]">{children}</ul>
      </div>
    </div>
  );
}

function DraftEditor({ draftId, onClose, onChange }: { draftId: any; onClose: () => void; onChange: () => void }) {
  const [draft, setDraft] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [wpStatus, setWpStatus] = useState('draft');

  // resetFields=false refreshes the draft's status, facts and image but keeps whatever is typed in
  // the Title / Meta / Content boxes, so marking a fact or uploading a creative never drops edits.
  const loadDraft = useCallback(async (resetFields = true) => {
    const res = await fetch(`/api/drafts/${draftId}`);
    const json = await res.json();
    setDraft(json);
    if (resetFields) {
      setTitle(json.title || '');
      setMeta(json.meta_description || '');
      setContent(json.content_html || '');
    }
  }, [draftId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    setMessage('');
    loadDraft();
  }, [loadDraft]);

  async function verifyFact(factId: any, status: string) {
    await fetch(`/api/facts/${factId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Reviewer is recorded server-side as the signed-in user (was hardcoded to one name).
      body: JSON.stringify({ status }),
    });
    loadDraft(false);
  }

  if (!draft) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }

  // Publishing sends the saved copy, so it waits until the boxes match what is saved.
  const dirty =
    title !== (draft.title || '') || meta !== (draft.meta_description || '') || content !== (draft.content_html || '');

  async function save(status: string | null) {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, meta_description: meta, content_html: content, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(status ? `Marked as ${status}.` : 'Saved.');
      onChange();
      // The server now holds what was sent, so keep the boxes (anything typed meanwhile stays).
      loadDraft(false);
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    const live = draft.wp_post_url ? '\n\nThis draft was already sent to WordPress. The WordPress post will NOT be deleted; remove it in WordPress if you want it gone.' : '';
    if (!window.confirm(`Delete this draft?\n\n"${draft.title || 'Untitled'}"\n\nThe draft, its facts and image links are removed for good. The keyword "${draft.keyword || ''}" goes back to the pending queue so it can be written again.${live}`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      onChange();
      onClose();
    } catch (err: any) {
      setMessage('Could not delete: ' + err.message);
      setSaving(false);
    }
  }

  async function uploadImage() {
    if (!imageFile) return;
    setSaving(true);
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('image', imageFile);
      const res = await fetch(`/api/drafts/${draft.id}/image`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage('Creative uploaded.');
      setImageFile(null);
      onChange();
      loadDraft(false);
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/drafts/${draft.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(`Published to WordPress: ${json.wpPostUrl}`);
      onChange();
      loadDraft(false);
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="ring-2 ring-primary/20">
      <CardHeader>
        <CardTitle>Review draft: {draft.keyword}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X />
            Close
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {draft.production_state && (
            <StatusBadge status={draft.production_state === 'READY_FOR_REVIEW' ? 'approved' : 'failed'}>
              {draft.production_state.replace(/_/g, ' ')}
            </StatusBadge>
          )}
          <span className="text-muted-foreground">{draft.word_count} words</span>
          <span className="text-muted-foreground">{draft.repair_attempts} auto-repair attempt(s)</span>
        </div>

        {draft.production_state === 'NEEDS_ATTENTION' && draft.validation_issues && (
          <NoteList heading="Unresolved issues after auto-repair (fix manually before approving):">
            {JSON.parse(draft.validation_issues).map((issue: string, i: number) => (
              <li key={i}>{issue}</li>
            ))}
          </NoteList>
        )}

        {draft.validation_warnings && JSON.parse(draft.validation_warnings).length > 0 && (
          <NoteList heading="Reviewer notes (not blocking, worth a look before approving):">
            {JSON.parse(draft.validation_warnings).map((w: string, i: number) => (
              <li key={i}>{w}</li>
            ))}
          </NoteList>
        )}

        <PeopleAlsoAskList
          items={draft.people_also_ask}
          label={'Google "People also ask" questions for this keyword (✓ = used in the FAQ)'}
        />

        <KeywordPanel draftId={draftId} refreshKey={draft.updated_at} />

        {draft.facts && draft.facts.length > 0 && (
          <div>
            <div className="mb-1 text-sm text-muted-foreground">Facts Register: verify each hard claim before approving:</div>
            <DataTable head={['Claim', 'Source', 'Jurisdiction', 'Status', '']}>
              {draft.facts.map((f: any) => (
                <tr key={f.id}>
                  <td className={TD}>{f.claim}</td>
                  <td className={TD_MUTED}>
                    {safeHref(f.source_url) ? (
                      <a href={safeHref(f.source_url)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {f.source_name || f.source_url}
                      </a>
                    ) : (
                      f.source_name || <span className="text-destructive">no source</span>
                    )}
                  </td>
                  <td className={TD_MUTED}>{f.jurisdiction}</td>
                  <td className={TD}>
                    <StatusBadge status={f.status === 'verified' ? 'approved' : 'pending'}>{f.status}</StatusBadge>
                  </td>
                  <td className={TD}>
                    {f.status !== 'verified' && (
                      <Button variant="outline" size="sm" onClick={() => verifyFact(f.id, 'verified')}>
                        <CheckCircle2 />
                        Mark verified
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}

        {draft.research_notes && (
          <div>
            <div className="mb-1 text-sm text-muted-foreground">Research notes (for your review only, not published):</div>
            <div className={`${PREVIEW_BOX} whitespace-pre-wrap`} style={{ maxHeight: 150 }}>
              {draft.research_notes}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div>
              <FieldLabel>Title</FieldLabel>
              <Input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Meta description</FieldLabel>
              <Input type="text" value={meta} onChange={(e) => setMeta(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col">
              <FieldLabel>Content (HTML)</FieldLabel>
              <Textarea rows={16} className="min-h-80 flex-1 font-mono text-xs [field-sizing:fixed]" value={content} onChange={(e) => setContent(e.target.value)} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            <FieldLabel>Preview</FieldLabel>
            <SafeHtml className={`prose-article ${PREVIEW_BOX} max-h-[640px] flex-1 bg-background`} html={content} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => save(null)} disabled={saving}>
            <Save />
            Save changes
          </Button>
          {dirty && <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>}
          {draft.status !== 'approved' && draft.status !== 'published' && (
            <>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => save('approved')} disabled={saving}>
                <ThumbsUp />
                Approve
              </Button>
              <Button variant="destructive" onClick={() => save('rejected')} disabled={saving}>
                <ThumbsDown />
                Reject
              </Button>
            </>
          )}
          <Button variant="destructive" className="ml-auto" onClick={deleteDraft} disabled={saving}>
            <Trash2 />
            Delete draft
          </Button>
        </div>

        <Separator />

        <div>
          <FieldLabel>Creative / featured image</FieldLabel>
          {draft.featured_image_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="mb-2 max-h-72 max-w-full rounded-lg border object-contain"
              src={`/api/uploads/${draft.featured_image_path.split(/[\\/]/).pop()}`}
              alt="creative"
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="file"
              accept="image/*"
              className="sm:max-w-sm"
              onChange={(e) => setImageFile((e.target as HTMLInputElement).files![0])}
            />
            <Button variant="outline" onClick={uploadImage} disabled={!imageFile || saving}>
              <Upload />
              Upload creative
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={wpStatus} onChange={(e) => setWpStatus(e.target.value)}>
            <option value="draft">Send to WordPress as Draft</option>
            <option value="publish">Publish live immediately</option>
          </NativeSelect>
          <Button onClick={publish} disabled={saving || draft.status !== 'approved' || dirty}>
            <Send />
            Publish to WordPress
          </Button>
          {draft.status === 'published' ? (
            <StatusBadge status="published">published</StatusBadge>
          ) : draft.status !== 'approved' ? (
            <span className="text-sm text-muted-foreground">Approve the draft first before publishing.</span>
          ) : dirty ? (
            <span className="text-sm text-muted-foreground">You have unsaved changes. Save them first, then publish.</span>
          ) : null}
        </div>

        {draft.wp_post_url && (
          <p className="text-sm text-muted-foreground">
            Already published:{' '}
            <a href={draft.wp_post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {draft.wp_post_url}
              <ExternalLink className="size-3" />
            </a>
          </p>
        )}

        {draft.wp_post_url ? (
          <BlogAnalytics url={draft.wp_post_url} keyword={draft.keyword} title={draft.title} />
        ) : (
          <div className="rounded-xl border bg-card p-4">
            <strong>How this blog performs</strong>
            <p className="mt-1 text-sm text-muted-foreground">Not published yet, so there is no Google or GA4 data. Once it is live, its clicks, impressions, position and the keywords it ranks for appear here (new pages take a few days to show up).</p>
          </div>
        )}

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}

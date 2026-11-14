'use client';

// Post my blog (top of Drafts & Review): the person's own blog, from a Word file or pasted, goes live
// as it is, or into Drafts. Every check is off unless ticked. The server does the work (lib/myBlog.ts).
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileUp, Loader2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldLabel, NativeSelect } from '@/components/shared/content-ui';
import { BannerDesigner } from '@/components/shared/banner-designer';
import { blogFromWordHtml } from '@/lib/wordImport';
import { useRole } from '@/hooks/use-role';

type Result = { ok: boolean; text: string; url?: string; issues?: string[]; draftId?: number };

const OPTIONS: { key: 'fact_check' | 'originality' | 'optimise' | 'ask_reviewer'; label: string; note: string }[] = [
  { key: 'fact_check', label: 'Fact check first', note: 'Reads every claim against official sources (uses AI credits, a few minutes). A wrong claim stops the post; the blog is saved to Drafts with the issues.' },
  { key: 'originality', label: 'Plagiarism / originality check', note: 'Compares the text with the pages ranking on Google and our own blogs (paid lookups).' },
  { key: 'optimise', label: 'Optimise for SEO (keep my words)', note: 'Adds what SEO needs without rewriting (uses AI credits). Saved to Drafts so you review it, then publish it from there.' },
  { key: 'ask_reviewer', label: 'Ask for the CA/CPA reviewer name', note: 'The reviewer is named in the byline; posting needs the name.' },
];

// One key per submission: a retry after an error or a cut-off answer sends the same key, and the
// server returns the draft it already made instead of saving or posting it again.
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(file);
  });

export function PostMyBlog({ onSaved }: { onSaved: () => void }) {
  const role = useRole();
  const canPost = role.can('blog.publish_now');
  const canSave = role.can('content.work');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState('');
  const [keyword, setKeyword] = useState('');
  const [author, setAuthor] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [authors, setAuthors] = useState<string[]>([]);
  const [opts, setOpts] = useState({ fact_check: false, originality: false, optimise: false, ask_reviewer: false });
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverData, setCoverData] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState('');
  const [busy, setBusy] = useState<'' | 'post' | 'save' | 'file'>('');
  const [result, setResult] = useState<Result | null>(null);
  const [requestKey, setRequestKey] = useState(newKey);
  // Set once the server answered with a draft: the form then offers that draft, never a second post.
  const [doneDraftId, setDoneDraftId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || authors.length) return;
    fetch('/api/my-blog')
      .then((r) => r.json())
      .then((j) => setAuthors(Array.isArray(j?.authors) ? j.authors : []))
      .catch(() => {});
  }, [open, authors.length]);

  async function readWord(file: File) {
    setBusy('file');
    setFileNote('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/audit/extract', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const blog = blogFromWordHtml(j.contentHtml || '');
      setHtml(blog.content);
      setTitle((t) => t || blog.title || j.title || '');
      if (blog.meta) setMeta((m) => m || blog.meta || '');
      if (blog.cover && !coverKey) {
        setCoverData(blog.cover);
        setFileNote('The picture above the title in the Word file is used as the banner (you can make or upload another below).');
      } else setFileNote(`Read "${file.name}".`);
    } catch (e: any) {
      setFileNote(`Error: ${e.message}`);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send(mode: 'post' | 'save') {
    if (mode === 'post' && !window.confirm(`Post "${title}" live on the website now${Object.values(opts).some(Boolean) ? ' (after the ticked checks)' : ', as it is, with no checks'}?`)) return;
    setBusy(mode);
    setResult(null);
    try {
      const res = await fetch('/api/my-blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, html, meta_description: meta, keyword, author, reviewer, mode, ...opts, cover_key: coverKey, cover_data: coverKey ? null : coverData, request_key: requestKey }),
      });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}). Press the button again: the same blog is never saved or posted twice.` }));
      if (j.draftId) {
        setDoneDraftId(j.draftId);
        onSaved();
      }
      if (!res.ok) {
        setResult({ ok: false, text: j.error || `HTTP ${res.status}`, draftId: j.draftId });
        return;
      }
      setResult({ ok: Boolean(j.posted) || mode === 'save', text: [j.message, ...(j.notes || [])].filter(Boolean).join(' '), url: j.url, issues: j.issues, draftId: j.draftId });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  }

  function startNew() {
    setTitle('');
    setHtml('');
    setMeta('');
    setKeyword('');
    setReviewer('');
    setCoverKey(null);
    setCoverData(null);
    setFileNote('');
    setResult(null);
    setDoneDraftId(null);
    setRequestKey(newKey());
  }

  if (!canSave) return null;
  const ready = title.trim() && html.trim() && !busy;
  const currentBanner = coverKey ? `/api/uploads/${coverKey}` : coverData;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Post my blog
          <div className="mt-0.5 text-sm font-normal text-muted-foreground">Your own blog, posted as it is. Every check is off unless you tick it.</div>
        </CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp /> : <ChevronDown />}
            {open ? 'Hide' : 'Open'}
          </Button>
        </CardAction>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={(e) => e.target.files?.[0] && readWord(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              {busy === 'file' ? <Loader2 className="animate-spin" /> : <FileUp />}
              Upload Word file (.docx)
            </Button>
            <span className="text-sm text-muted-foreground">or paste the text or HTML below.</span>
          </div>
          {fileNote && <p className={`text-sm ${fileNote.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'}`}>{fileNote}</p>}
          <div>
            <FieldLabel>Title</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="The blog's title (shown as the H1 on the website)" />
          </div>
          <div>
            <FieldLabel>Blog text</FieldLabel>
            <Textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={10} placeholder="Paste the article (plain text: a blank line between paragraphs; or HTML starting at <h2>)" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>Meta description (optional)</FieldLabel>
              <Input value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={400} placeholder="The line Google shows under the title" />
            </div>
            <div>
              <FieldLabel>Main keyword (optional)</FieldLabel>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={200} placeholder="Defaults to the title" />
            </div>
            <div>
              <FieldLabel>Author</FieldLabel>
              <NativeSelect value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Author">
                <option value="">Random pick from the blog authors</option>
                {authors.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {opts.ask_reviewer && (
              <div>
                <FieldLabel>CA/CPA reviewer</FieldLabel>
                <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={160} placeholder='For example "Amit Agarwal, CA"' />
              </div>
            )}
          </div>

          <div>
            <FieldLabel>Banner (cover)</FieldLabel>
            <BannerDesigner
              currentUrl={currentBanner}
              currentLabel={coverKey ? 'Chosen banner' : coverData ? 'Banner from your file' : 'Banner now'}
              disabled={!title.trim()}
              make={async (ask) => {
                const res = await fetch('/api/my-blog/banner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, keyword, author, ...ask }) });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
                return j;
              }}
              choose={async (key) => setCoverKey(key)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                ref={coverRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 8 * 1024 * 1024) return setFileNote('Error: the banner must be under 8 MB.');
                  setCoverData(await readAsDataUrl(f));
                  setCoverKey(null);
                }}
              />
              <Button variant="outline" size="sm" onClick={() => coverRef.current?.click()} disabled={!!busy}>
                Upload my own banner
              </Button>
              <span className="text-xs text-muted-foreground">With no banner chosen, the usual one is made when it is posted.</span>
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel>Checks (all off: posted as it is)</FieldLabel>
            {OPTIONS.map((o) => (
              <label key={o.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={opts[o.key]} onChange={(e) => setOpts({ ...opts, [o.key]: e.target.checked })} />
                <span>
                  <strong>{o.label}</strong>
                  <span className="block text-xs text-muted-foreground">{o.note}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">Always checked (free): reviewer placeholders such as [VERIFY] or [AUTHOR NAME] and leftover AI notes stop a post until you remove them.</p>
          </div>

          {doneDraftId ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/?tab=drafts&draft=${doneDraftId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline">
                Open draft #{doneDraftId}
              </a>
              <Button variant="outline" size="sm" onClick={startNew}>
                Start a new blog
              </Button>
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => send('post')} disabled={!ready || !canPost || opts.optimise} title={!canPost ? 'Only an admin or a manager can post live straight away' : opts.optimise ? 'Optimise saves to Drafts for review first' : ''}>
              {busy === 'post' ? <Loader2 className="animate-spin" /> : <Send />}
              Post now
            </Button>
            <Button variant="outline" onClick={() => send('save')} disabled={!ready}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
              Save to Drafts
            </Button>
            {!canPost && <span className="text-sm text-muted-foreground">Only an admin or a manager can post live; you can save it to Drafts.</span>}
            {busy === 'post' && opts.fact_check && <span className="text-sm text-muted-foreground">Fact checking, then posting (a few minutes)…</span>}
          </div>
          )}

          {result && (
            <div className={`rounded-lg border p-3 text-sm ${result.ok ? '' : 'border-destructive/40'}`}>
              <div className={result.ok ? '' : 'text-destructive'}>{result.text}</div>
              {result.url && (
                <a href={result.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                  {result.url}
                  <ExternalLink className="size-3" />
                </a>
              )}
              {!!result.issues?.length && (
                <ul className="mt-2 list-disc pl-5">
                  {result.issues.map((i, n) => (
                    <li key={n}>{i}</li>
                  ))}
                </ul>
              )}
              {result.draftId && !result.url && !doneDraftId && (
                <a href={`/?tab=drafts&draft=${result.draftId}`} className="mt-1 inline-block text-primary underline">
                  Open it in Drafts & Review
                </a>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

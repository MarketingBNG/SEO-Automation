'use client';

// Website Content: the pages and blog posts the new custom website reads through /api/site/v1.
// Saving tells the website to refresh that page (when the webhook is set up).
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRole } from '@/hooks/use-role';

// A new item starts with no URL path: '/' is the home page, and saving over it would replace it.
const EMPTY_PAGE = { slug: '', title: '', metaDescription: '', canonical: '', status: 'published', sections: { hero: { heading: '', html: '<p></p>' } }, schema: [] };
const EMPTY_POST = { slug: '/blog/', title: '', metaDescription: '', canonical: '', status: 'published', html: '<p></p>', cover: { url: '', alt: '' }, categories: [], tags: [], schema: [] };
const pretty = (v: any) => JSON.stringify(v ?? null, null, 2);

function Editor({ type, start, canEdit, onDone }: { type: 'page' | 'post'; start: any; canEdit: boolean; onDone: () => void }) {
  const [item, setItem] = useState<any>(start);
  // A new item is saved with create: true, so the server refuses a URL path that is already taken.
  // An existing item keeps its URL path (renaming would leave the old row behind).
  const [isNew, setIsNew] = useState(!start.updatedAt);
  const [sections, setSections] = useState(pretty(start.sections || {}));
  const [schema, setSchema] = useState(pretty(start.schema || []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: any) => setItem({ ...item, [k]: v });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      if (isNew && !String(item.slug || '').trim()) throw new Error('Enter the URL path of the new item, for example /services/itin.');
      const out = { ...item, schema: JSON.parse(schema || '[]'), ...(type === 'page' ? { sections: JSON.parse(sections || '{}') } : {}) };
      const res = await fetch('/api/site-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', type, item: out, ...(isNew ? { create: true } : {}) }) });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      if (isNew) {
        setIsNew(false);
        setItem({ ...item, slug: j.slug });
      }
      setMsg(j.webhook?.sent ? 'Saved. The website was told to refresh this page.' : `Saved. The website was not told yet: ${j.webhook?.reason}.`);
      onDone();
    } catch (e: any) {
      setMsg(e instanceof SyntaxError ? 'The sections or schema box is not valid JSON.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border bg-background px-2 py-1 text-sm';
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="font-medium">URL path</div>
          <input className={input} value={item.slug} onChange={(e) => set('slug', e.target.value)} disabled={!canEdit || !isNew} placeholder="/services/itin" />
        </label>
        <label className="space-y-1">
          <div className="font-medium">Status</div>
          <select className={input} value={item.status} onChange={(e) => set('status', e.target.value)} disabled={!canEdit}>
            <option value="published">Published</option>
            <option value="draft">Draft (hidden from the website)</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <div className="font-medium">Title (the &lt;title&gt; tag)</div>
        <input className={input} value={item.title} onChange={(e) => set('title', e.target.value)} disabled={!canEdit} />
      </label>
      <label className="block space-y-1">
        <div className="font-medium">Meta description</div>
        <textarea className={input} rows={2} value={item.metaDescription || ''} onChange={(e) => set('metaDescription', e.target.value)} disabled={!canEdit} />
      </label>
      <label className="block space-y-1">
        <div className="font-medium">Canonical URL</div>
        <input className={input} value={item.canonical || ''} onChange={(e) => set('canonical', e.target.value)} disabled={!canEdit} />
      </label>
      {type === 'page' ? (
        <label className="block space-y-1">
          <div className="font-medium">Sections (JSON: each key is an area of the page, with heading, html, items, image, cta)</div>
          <textarea className={`${input} font-mono`} rows={14} value={sections} onChange={(e) => setSections(e.target.value)} disabled={!canEdit} />
        </label>
      ) : (
        <>
          <label className="block space-y-1">
            <div className="font-medium">Article (HTML)</div>
            <textarea className={`${input} font-mono`} rows={14} value={item.html || ''} onChange={(e) => set('html', e.target.value)} disabled={!canEdit} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <div className="font-medium">Cover image URL</div>
              <input className={input} value={item.cover?.url || ''} onChange={(e) => set('cover', { ...(item.cover || {}), url: e.target.value })} disabled={!canEdit} />
            </label>
            <label className="space-y-1">
              <div className="font-medium">Cover alt text</div>
              <input className={input} value={item.cover?.alt || ''} onChange={(e) => set('cover', { ...(item.cover || {}), alt: e.target.value })} disabled={!canEdit} />
            </label>
            <label className="space-y-1">
              <div className="font-medium">Categories (comma separated)</div>
              <input className={input} value={(item.categories || []).join(', ')} onChange={(e) => set('categories', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} disabled={!canEdit} />
            </label>
            <label className="space-y-1">
              <div className="font-medium">Tags (comma separated)</div>
              <input className={input} value={(item.tags || []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} disabled={!canEdit} />
            </label>
          </div>
        </>
      )}
      <label className="block space-y-1">
        <div className="font-medium">Schema (JSON-LD list)</div>
        <textarea className={`${input} font-mono`} rows={5} value={schema} onChange={(e) => setSchema(e.target.value)} disabled={!canEdit} />
      </label>
      {msg && <div className="text-muted-foreground">{msg}</div>}
      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
      )}
    </div>
  );
}

export default function WebsiteContentTab() {
  const { can } = useRole();
  const canEdit = can('content.work');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: 'page' | 'post'; item: any } | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const edit = (v: { type: 'page' | 'post'; item: any } | null) => {
    setDeleteErr(null);
    setEditing(v);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/site-content');
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      setData(j);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function open(slug: string, type: 'page' | 'post') {
    const res = await fetch(`/api/site-content?slug=${encodeURIComponent(slug)}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) edit({ type, item: j.item });
  }
  async function remove(slug: string) {
    if (!confirm(`Delete ${slug} from the website content?`)) return;
    setDeleteErr(null);
    const res = await fetch('/api/site-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', slug }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      // Keep the editor open so it is clear the item is still there.
      setDeleteErr(`Not deleted: ${j.error || (res ? `HTTP ${res.status}` : 'the server could not be reached')}`);
      return;
    }
    edit(null);
    load();
  }

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <Loader2 className="size-5 animate-spin" />;
  const s = data.setup;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Website Content</CardTitle>
          <CardDescription>The words, meta tags and blog posts of the new website. The website reads them through the content API; saving here updates the live site.</CardDescription>
          {canEdit && (
            <CardAction className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => edit({ type: 'page', item: { ...EMPTY_PAGE } })}>
                <Plus className="size-4" /> Page
              </Button>
              <Button variant="outline" size="sm" onClick={() => edit({ type: 'post', item: { ...EMPTY_POST } })}>
                <Plus className="size-4" /> Blog post
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Read key for the website: {s.readKey ? 'set' : 'not set (add SITE_API_KEY in Coolify)'}</div>
          <div>Import key: {s.importKey ? 'set' : 'not set (add SITE_IMPORT_KEY in Coolify for the one-time import)'}</div>
          <div>Refresh signal to the website: {s.webhook ? 'set' : 'not set (add SITE_WEBHOOK_URL and SITE_WEBHOOK_SECRET in Coolify)'}</div>
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing.item.title || 'New'} {editing.type === 'page' ? '(page)' : '(blog post)'}
            </CardTitle>
            <CardAction className="flex gap-2">
              {canEdit && editing.item.updatedAt && (
                <Button variant="ghost" size="sm" onClick={() => remove(editing.item.slug)}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => edit(null)}>
                Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {deleteErr && <div className="mb-3 text-sm text-red-600">{deleteErr}</div>}
            <Editor key={editing.item.slug + editing.type} type={editing.type} start={editing.item} canEdit={canEdit} onDone={load} />
          </CardContent>
        </Card>
      )}

      {(['page', 'post'] as const).map((type) => {
        const rows = data.items.filter((r: any) => r.type === type);
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle>
                {type === 'page' ? 'Pages' : 'Blog posts'} ({rows.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <div className="text-sm text-muted-foreground">None yet. They arrive with the one-time import from the website developer, or add one above.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.slug} className="border-t">
                        <td className="py-1.5">
                          <button className="text-left underline" onClick={() => open(r.slug, type)}>
                            {r.title}
                          </button>
                          <div className="text-xs text-muted-foreground">{r.slug}</div>
                        </td>
                        <td>{r.status === 'draft' ? 'Draft' : 'Published'}</td>
                        <td className="text-right text-xs text-muted-foreground">{new Date(r.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

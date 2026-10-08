'use client';

// Images inside the article. The writer marks where a visual would help; here the team uploads an
// image for each spot (with alt text), removes a suggestion, or adds an image after any section.
// Images are stored on the dashboard and go to the WordPress Media Library when the blog publishes.
import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Slot = { index: number; text: string; section: string | null };
// Google reads FAQ answers as plain text, so images stay out of that section.
const isFaq = (h: string) => /^\s*(frequently asked questions|faqs?)\b/i.test(h);

function Uploader({ draftId, target, defaultAlt, onDone, disabled }: { draftId: number; target: { slot?: number; heading?: number }; defaultAlt: string; onDone: (msg: string) => void; disabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(defaultAlt);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('alt', alt);
      if (caption.trim()) fd.append('caption', caption.trim());
      if (target.slot !== undefined) fd.append('slot', String(target.slot));
      if (target.heading !== undefined) fd.append('heading', String(target.heading));
      const res = await fetch(`/api/drafts/${draftId}/images`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setFile(null);
      setCaption('');
      onDone('Image placed in the article.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Input type="file" accept="image/*" className="h-9" disabled={disabled || busy} onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)} />
      <Input className="h-9" placeholder="Alt text (what the image shows)" value={alt} onChange={(e) => setAlt(e.target.value)} disabled={disabled || busy} />
      <Input className="h-9" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={disabled || busy} />
      <Button size="sm" className="h-9" disabled={disabled || busy || !file || alt.trim().length < 5} onClick={upload}>
        {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} Place image
      </Button>
      {err && <p className="text-xs text-red-500 sm:col-span-4">{err}</p>}
    </div>
  );
}

// refreshKey: changes when the saved article changes (its updated_at), so the spots are re-read
// after the text is saved and never point at a suggestion that moved.
export function ArticleImages({ draftId, dirty, published, refreshKey, onChanged }: { draftId: number; dirty: boolean; published: boolean; refreshKey?: string; onChanged: (msg: string) => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [headings, setHeadings] = useState<string[]>([]);
  const [heading, setHeading] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    const j = await fetch(`/api/drafts/${draftId}/images`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setSlots(j?.slots || []);
    setHeadings(j?.headings || []);
  }, [draftId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);
  const done = (msg: string) => {
    load();
    onChanged(msg);
  };
  async function removeNote(slot: number) {
    setBusy(slot);
    try {
      const res = await fetch(`/api/drafts/${draftId}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_note', slot }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      done('Suggestion removed.');
    } catch (e: any) {
      onChanged(`Error: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }
  const disabled = dirty || published;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Images in the article</div>
        <p className="text-xs text-muted-foreground">
          The cover image is added automatically. Inside the article the writer only marks where a visual would help; it never invents one. Upload an image for each spot (or remove the spot), or add an image after any section. Images go to the WordPress Media Library when the blog publishes. A blog does not publish while a suggestion is still in the text.
        </p>
        {dirty && <p className="text-xs text-amber-600 dark:text-amber-400">Save your text changes first; placing an image edits the saved article.</p>}
        {published && <p className="text-xs text-muted-foreground">This blog is live. Change its images on the website through the assistant.</p>}
      </div>
      {slots.length > 0 ? (
        <ul className="space-y-3">
          {slots.map((s) => (
            <li key={`${s.index}:${s.text}`} className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium">Suggested image {s.index + 1}</span>
                  {s.section && <span className="text-muted-foreground"> in &quot;{s.section}&quot;</span>}
                  <div className="text-muted-foreground">{s.text || 'No description given.'}</div>
                </div>
                <Button size="sm" variant="ghost" disabled={disabled || busy === s.index} onClick={() => removeNote(s.index)} title="Remove this suggestion from the article">
                  {busy === s.index ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
                </Button>
              </div>
              <Uploader key={`${s.index}:${s.text}:${refreshKey || ''}`} draftId={draftId} target={{ slot: s.index }} defaultAlt={s.text.slice(0, 120)} onDone={done} disabled={disabled} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No image suggestions are left in the article.</p>
      )}
      {headings.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-medium">Add an image after a section</div>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm sm:max-w-md" value={heading} onChange={(e) => setHeading(Number(e.target.value))} disabled={disabled}>
            {headings.map((h, i) => (
              <option key={i} value={i} disabled={isFaq(h)}>{isFaq(h) ? `${h} (no images in the FAQ)` : h}</option>
            ))}
          </select>
          <Uploader draftId={draftId} target={{ heading }} defaultAlt="" onDone={done} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

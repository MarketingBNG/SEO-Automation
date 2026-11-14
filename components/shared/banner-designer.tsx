'use client';

// Banner (cover) design with a preview before posting: "Make banner" / "Try another design" makes a
// fresh banner and shows it next to the current one; "Apply my comment" redoes the banner on show with
// the same design (same variant, layout, words and picture) and changes only what the comments ask; "Use this banner" keeps it, and posting uses the chosen
// banner (never an automatic one instead). The person can steer it: the title words to make bold
// (art direction "main") and the picture on it (art direction "cutout"). Used by Drafts & Review
// (an open draft) and Post my blog (before the draft exists).
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/shared/content-ui';
import { BANNER_CUTOUTS, BANNER_STYLES } from '@/lib/bannerOptions';

export type BannerAsk = { main: string; cutout: string; variant: number; style: string; feedback: string };

type Made = { key: string; url: string; source?: string; main?: string; cutout?: string; applied?: string; ignored?: string; style?: string };

export function BannerDesigner({
  currentUrl,
  currentLabel,
  make,
  choose,
  disabled,
}: {
  currentUrl: string | null; // the banner the post carries now, or null for "no banner yet"
  currentLabel?: string;
  make: (ask: BannerAsk) => Promise<Made>;
  choose: (key: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [main, setMain] = useState('');
  const [cutout, setCutout] = useState('');
  const [style, setStyle] = useState('');
  // What the person wants changed in the banner on show ("the statue is cut, add a shadow").
  const [feedback, setFeedback] = useState('');
  // Comments already applied to the banner on show: each new comment is added to them, so earlier
  // fixes stay. A fresh design starts the list again.
  const [comments, setComments] = useState<string[]>([]);
  const [variant, setVariant] = useState(0);
  // The design on show: its variant, layout, bold words and picture, reused by "Apply my comment".
  const [shown, setShown] = useState<{ variant: number; style: string; main: string; cutout: string } | null>(null);
  const [candidate, setCandidate] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // fresh: a new design (next variant, no comments). Otherwise the design on show again, with every
  // comment so far plus the new one, and nothing else changed.
  async function makeOne(fresh: boolean) {
    const comment = feedback.trim();
    if (!fresh && (!shown || !comment)) return;
    setBusy(true);
    setNote('');
    try {
      const list = fresh ? [] : [...comments, comment];
      const ask: BannerAsk = fresh
        ? { main: main.trim(), cutout, variant, style, feedback: '' }
        : { main: shown!.main, cutout: shown!.cutout, variant: shown!.variant, style: shown!.style, feedback: list.join(' | ') };
      const c = await make(ask);
      setCandidate(c);
      setComments(list);
      // The layout the banner service actually used, so a comment keeps it even when the person left the choice to it.
      setShown({ variant: ask.variant, style: c.style || ask.style, main: c.main ?? ask.main, cutout: c.cutout ?? ask.cutout });
      if (fresh) setVariant((v) => v + 1);
      else setFeedback('');
      const notes: string[] = [];
      if (c.source === 'local') notes.push('Made with the built-in design (the banner service is not set up or did not answer).');
      if (!fresh && c.applied) notes.push(`Changed: ${c.applied}.`);
      if (!fresh && c.ignored) notes.push(`Could not do: ${c.ignored}.`);
      if (!fresh && !c.applied && !c.ignored && c.source !== 'local') notes.push('Your comment was sent with the same design.');
      setNote(notes.join(' '));
    } catch (e: any) {
      setNote(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!candidate) return;
    setBusy(true);
    setNote('');
    try {
      await choose(candidate.key);
      setCandidate(null);
      setNote('This banner is chosen. Posting uses it.');
    } catch (e: any) {
      setNote(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">{currentLabel || 'Banner now'}</div>
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="Current banner" className="w-full rounded-md border object-contain" />
          ) : (
            <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No banner yet</div>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">New design (preview)</div>
          {candidate ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={candidate.url} alt="New banner design" className="w-full rounded-md border object-contain" />
          ) : (
            <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{busy ? 'Making the banner…' : 'Press "Make banner" to see one'}</div>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={main} onChange={(e) => setMain(e.target.value)} maxLength={120} placeholder="Words to make bold (the start of the title; optional)" aria-label="Words to highlight from the title" />
        <NativeSelect value={cutout} onChange={(e) => setCutout(e.target.value)} aria-label="Picture on the banner">
          <option value="">Picture: let the designer choose</option>
          {BANNER_CUTOUTS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Banner layout">
          <option value="">Layout: let the designer choose</option>
          {BANNER_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Textarea
        rows={2}
        maxLength={500}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder='What to change in this banner, e.g. "The statue is cut at the bottom, make it smaller" or "Bigger title". Only that is changed.'
        aria-label="What to change in the banner on show"
      />
      {comments.length > 0 && <p className="text-xs text-muted-foreground">Comments applied so far: {comments.join(' · ')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => makeOne(false)} disabled={busy || disabled || !shown || !feedback.trim()} title={!shown ? 'Make a banner first' : !feedback.trim() ? 'Write what to change first' : 'Same design, only your comment changed'}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Apply my comment
        </Button>
        <Button variant="outline" onClick={() => makeOne(true)} disabled={busy || disabled}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {shown ? 'Try another design' : 'Make banner'}
        </Button>
        <Button onClick={keep} disabled={busy || disabled || !candidate}>
          Use this banner
        </Button>
        <span className="text-xs text-muted-foreground">Each new design may use a small AI call (art direction) and one image. In Testing mode or while AI work is paused, no AI call or AI image is made.</span>
      </div>
      {note && <p className={`text-sm ${note.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'}`}>{note}</p>}
    </div>
  );
}

'use client';

// Banner (cover) design with a preview before posting: "Make banner" / "Try another design" makes a
// banner and shows it next to the current one; "Use this banner" keeps it, and posting uses the chosen
// banner (never an automatic one instead). The person can steer it: the title words to make bold
// (art direction "main") and the picture on it (art direction "cutout"). Used by Drafts & Review
// (an open draft) and Post my blog (before the draft exists).
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/shared/content-ui';
import { BANNER_CUTOUTS, BANNER_STYLES } from '@/lib/bannerOptions';

export type BannerAsk = { main: string; cutout: string; variant: number; style: string };

export function BannerDesigner({
  currentUrl,
  currentLabel,
  make,
  choose,
  disabled,
}: {
  currentUrl: string | null; // the banner the post carries now, or null for "no banner yet"
  currentLabel?: string;
  make: (ask: BannerAsk) => Promise<{ key: string; url: string; source?: string }>;
  choose: (key: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [main, setMain] = useState('');
  const [cutout, setCutout] = useState('');
  const [style, setStyle] = useState('');
  const [variant, setVariant] = useState(0);
  const [candidate, setCandidate] = useState<{ key: string; url: string; source?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function makeOne() {
    setBusy(true);
    setNote('');
    try {
      const c = await make({ main: main.trim(), cutout, variant, style });
      setCandidate(c);
      // The next press asks for a different design.
      setVariant((v) => v + 1);
      if (c.source === 'local') setNote('Made with the built-in design (the banner service is not set up or did not answer). Try another design for a different colour and layout.');
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
          <option value="">Layout: a different one each time</option>
          {BANNER_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={makeOne} disabled={busy || disabled}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {candidate || variant > 0 ? 'Try another design' : 'Make banner'}
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

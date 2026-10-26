'use client';

// Brand Palette: write a short brief, get three colour directions (explored, critiqued and refined by
// the Creative Director following the learned skills), see them on real layouts, check every contrast
// pairing (worked out in code), refine one with feedback, and export it.
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2, Palette, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/shared/status-badge';
import { onScreen } from '@/components/shared/on-screen';
import { jobsChanged } from '@/components/shared/job-progress';
import { useRole } from '@/hooks/use-role';

const DEFAULT_BRIEF = {
  name: 'USAIndiaCFO',
  business: 'CFO, tax, accounting and compliance services for Indian founders, NRIs and US-India businesses: US incorporation, US and India tax, FEMA, FBAR, bookkeeping, virtual CFO.',
  audience: 'Indian founders expanding to the US, NRIs, and US companies with operations in India; decision makers aged 28 to 55.',
  personality: 'Expert, trustworthy, clear, calm, premium, modern',
  evoke: 'Confidence, safety, clarity, "they have my back"',
  avoidFeelings: 'Flashy, cheap, bureaucratic, intimidating',
  competitors: '',
  keep: '',
  avoid: '',
  uses: 'LinkedIn and Instagram posts and carousels, reels, website, blog covers, PDFs and pitch decks',
  notes: '',
};
const CURRENT = 'Ledger navy #0B1430 and saffron gold #E8B04B (current brand)';

const FIELDS: { key: keyof typeof DEFAULT_BRIEF; label: string; rows?: number }[] = [
  { key: 'name', label: 'Brand name' },
  { key: 'business', label: 'What the business does', rows: 2 },
  { key: 'audience', label: 'Audience', rows: 2 },
  { key: 'personality', label: 'Personality (a few words)' },
  { key: 'evoke', label: 'Feelings to evoke' },
  { key: 'avoidFeelings', label: 'Feelings to avoid' },
  { key: 'competitors', label: 'Competitors and their colours (optional)' },
  { key: 'keep', label: 'Colours to keep (optional)' },
  { key: 'avoid', label: 'Colours to avoid (optional)' },
  { key: 'uses', label: 'Where it will be used' },
  { key: 'notes', label: 'Anything else (optional)', rows: 2 },
];

const role = (d: any, r: string) => d.colors.find((c: any) => c.role === r);
const hexOf = (d: any, r: string, fallback: string) => role(d, r)?.hex || fallback;

function loadFont(family?: string) {
  if (!family || typeof document === 'undefined') return;
  const id = `gf-${family.replace(/\W+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function Swatch({ c }: { c: any }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy the hex code"
      onClick={() => navigator.clipboard?.writeText(c.hex).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      className="flex min-h-24 flex-col justify-between rounded-lg border p-2 text-left text-xs shadow-sm transition hover:scale-[1.02]"
      style={{ background: c.hex, color: c.text }}
    >
      <span className="font-semibold uppercase tracking-wide opacity-80">{c.role}</span>
      <span>
        <span className="block font-semibold">{c.name}</span>
        <span className="flex items-center gap-1 font-mono">{c.hex}{copied ? <Check className="size-3" /> : <Copy className="size-3 opacity-60" />}</span>
      </span>
    </button>
  );
}

function Scale({ c }: { c: any }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{c.name} ({c.role})</div>
      <div className="flex overflow-hidden rounded-md border">
        {c.scale.map((s: any) => <div key={s.step} title={`${s.step}: ${s.hex}`} className="h-7 flex-1" style={{ background: s.hex }} />)}
      </div>
    </div>
  );
}

// The palette on real layouts: a social post, a blog cover, interface parts and a chart.
function Previews({ d }: { d: any }) {
  const primary = hexOf(d, 'primary', '#0B1430');
  const secondary = hexOf(d, 'secondary', primary);
  const accent = hexOf(d, 'accent', '#E8B04B');
  const bg = hexOf(d, 'background', '#FFFFFF');
  const light = hexOf(d, 'neutral-light', '#F3F4F6');
  const ink = hexOf(d, 'neutral-dark', '#111111');
  const textOnPrimary = role(d, 'primary')?.text || '#FFFFFF';
  const textOnAccent = role(d, 'accent')?.text || '#111111';
  const head = d.typography?.heading ? `'${d.typography.heading}', sans-serif` : undefined;
  const body = d.typography?.body ? `'${d.typography.body}', sans-serif` : undefined;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex aspect-square flex-col justify-between rounded-xl p-5 shadow" style={{ background: primary, color: textOnPrimary, fontFamily: body }}>
        <div className="text-xs font-semibold tracking-widest" style={{ color: accent }}>USAINDIACFO</div>
        <div>
          <div className="text-2xl leading-tight font-bold" style={{ fontFamily: head }}>FBAR deadline: what every NRI must file this year</div>
          <div className="mt-2 text-sm opacity-80">Three forms, one date, and the penalty that catches people out.</div>
        </div>
        <div className="flex items-center justify-between">
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accent, color: textOnAccent }}>Read the guide</span>
          <span className="text-xs opacity-70">1 / 6</span>
        </div>
      </div>
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-xl p-4 shadow" style={{ background: light, color: ink, fontFamily: body }}>
          <div className="absolute inset-y-0 right-0 w-1/3" style={{ background: secondary }} />
          <div className="absolute right-6 bottom-6 size-16 rounded-full" style={{ background: accent }} />
          <div className="relative max-w-[62%]">
            <div className="text-[10px] font-semibold tracking-widest" style={{ color: primary }}>US TAX · GUIDE</div>
            <div className="mt-1 text-lg leading-tight font-bold" style={{ fontFamily: head, color: primary }}>How to get a US EIN from India without an SSN</div>
            <div className="mt-2 h-1 w-12 rounded" style={{ background: accent }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ background: bg, fontFamily: body }}>
          <span className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ background: primary, color: textOnPrimary }}>Book a call</span>
          <span className="rounded-md px-3 py-1.5 text-sm font-semibold" style={{ background: accent, color: textOnAccent }}>Get started</span>
          <span className="rounded-md border-2 px-3 py-1.5 text-sm font-semibold" style={{ borderColor: primary, color: primary }}>Learn more</span>
          {(['success', 'warning', 'danger'] as const).map((r) => role(d, r) && <span key={r} className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: role(d, r).hex, color: role(d, r).text }}>{r}</span>)}
        </div>
        <div className="flex h-24 items-end gap-2 rounded-xl border p-3" style={{ background: bg }}>
          {[primary, secondary, accent, ink, hexOf(d, 'success', primary)].map((c, i) => <div key={i} className="flex-1 rounded-t" style={{ background: c, height: `${[85, 62, 48, 35, 70][i]}%` }} />)}
        </div>
      </div>
    </div>
  );
}

function Direction({ d, i, palette, onDone, canWork }: { d: any; i: number; palette: any; onDone: (m: string) => void; canWork: boolean }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = palette.chosen === i;
  useEffect(() => { loadFont(d.typography?.heading); loadFont(d.typography?.body); }, [d.typography?.heading, d.typography?.body]);

  async function act(body: any, done: string) {
    setBusy(true);
    const res = await fetch('/api/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    onDone(res.ok ? j.note || done : j.error || 'Failed');
    jobsChanged();
  }
  async function exportIt(kind: 'css' | 'json') {
    const { exportTokens } = await import('@/lib/brandPaletteExport');
    const t = exportTokens(d);
    if (kind === 'css') {
      await navigator.clipboard?.writeText(t.css);
      onDone('CSS variables copied.');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(t.json, null, 2)], { type: 'application/json' }));
      a.download = `${String(d.name).replace(/[^\w]+/g, '-').toLowerCase()}-palette.json`;
      a.click();
    }
  }

  const scores = Object.entries(d.scores || {}) as [string, number][];
  return (
    <Card className={chosen ? 'border-2 border-[#E8B04B]' : ''}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{i + 1}. {d.name}</span>
          {chosen && <StatusBadge status="gold">Chosen</StatusBadge>}
          <StatusBadge status={d.passing === d.total ? 'approved' : 'gold'}>{d.passing}/{d.total} contrast checks pass</StatusBadge>
        </CardTitle>
        <CardDescription>{d.idea}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{d.story}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">{d.colors.map((c: any, k: number) => <Swatch key={k} c={c} />)}</div>
        <div className="text-xs text-muted-foreground">Proportion: {d.ratio}</div>
        <Previews d={d} />
        <div className="grid gap-3 md:grid-cols-3">{d.colors.filter((c: any) => ['primary', 'secondary', 'accent'].includes(c.role)).map((c: any, k: number) => <Scale key={k} c={c} />)}</div>
        <div>
          <div className="mb-1 font-semibold">Contrast (worked out from the hex codes)</div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <tbody>
                {d.checks.map((c: any, k: number) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="px-2 py-1.5">{c.label}</td>
                    <td className="px-2 py-1.5"><span className="rounded px-2 py-0.5 font-semibold" style={{ background: c.bg, color: c.fg }}>Aa</span></td>
                    <td className="px-2 py-1.5 tabular-nums">{c.ratio}:1</td>
                    <td className="px-2 py-1.5"><StatusBadge status={c.pass ? 'approved' : 'failed'}>{c.grade}</StatusBadge></td>
                    <td className="px-2 py-1.5 text-muted-foreground">{c.fix ? <>Use <span className="font-mono">{c.fix.hex}</span> instead ({c.fix.ratio}:1)</> : `needs ${c.min}:1`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {d.typography && (
          <div className="rounded-lg border p-3">
            <div style={{ fontFamily: `'${d.typography.heading}', sans-serif` }} className="text-xl font-bold">{d.typography.heading} for headings</div>
            <div style={{ fontFamily: `'${d.typography.body}', sans-serif` }}>{d.typography.body} for body text. Clear numbers matter: 15% TDS, Form 5472, $25,000 penalty.</div>
            <div className="mt-1 text-xs text-muted-foreground">{d.typography.why}</div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div><div className="font-semibold">Do</div><ul className="list-disc pl-5">{(d.do || []).map((x: string, k: number) => <li key={k}>{x}</li>)}</ul></div>
          <div><div className="font-semibold">Don&apos;t</div><ul className="list-disc pl-5">{(d.dont || []).map((x: string, k: number) => <li key={k}>{x}</li>)}</ul></div>
        </div>
        {scores.length > 0 && <div className="flex flex-wrap gap-1.5">{scores.map(([k, v]) => <span key={k} className="rounded-full border px-2 py-0.5 text-xs">{k.replace(/_/g, ' ')} <b>{v}</b>/10</span>)}</div>}
        {d.critique && <div className="text-xs text-muted-foreground">Remaining weakness: {d.critique}</div>}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {canWork && <Button size="sm" variant={chosen ? 'secondary' : 'default'} disabled={busy || chosen} onClick={() => act({ action: 'choose', id: palette.id, index: i }, 'Chosen.')}><Check />{chosen ? 'Chosen' : 'Choose this'}</Button>}
          <Button size="sm" variant="outline" onClick={() => exportIt('css')}><Copy />Copy CSS variables</Button>
          <Button size="sm" variant="outline" onClick={() => exportIt('json')}><Download />Download JSON</Button>
        </div>
        {canWork && (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-64 flex-1" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback to refine this direction (optional), e.g. warmer gold, less blue" />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: 'refine', id: palette.id, index: i, feedback }, 'Refining.')}>{busy ? <Loader2 className="animate-spin" /> : <Wand2 />}Refine this one</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BrandTab() {
  const who = useRole();
  const canWork = who.can('content.work');
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const j = await fetch('/api/brand').then((r) => r.json()).catch(() => null);
    if (j?.palettes) setList(j.palettes);
    return j?.palettes || [];
  }, []);
  const openPalette = useCallback(async (id: number) => {
    const j = await fetch(`/api/brand?id=${id}`).then((r) => r.json()).catch(() => null);
    if (j && !j.error) setOpen(j);
  }, []);

  useEffect(() => {
    loadList().then((rows: any[]) => rows[0] && openPalette(rows[0].id));
  }, [loadList, openPalette]);
  // While a palette is being made, check every few seconds.
  useEffect(() => {
    if (!list.some((p) => p.status === 'generating')) return;
    const t = setInterval(async () => {
      if (!onScreen('tab-brand')) return;
      const rows = await loadList();
      if (open && rows.find((p: any) => p.id === open.id)?.status !== open.status) openPalette(open.id);
    }, 6000);
    return () => clearInterval(t);
  }, [list, open, loadList, openPalette]);

  async function generate() {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', brief }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? j.note : j.error || 'Failed');
    jobsChanged();
    await loadList();
    if (j.id) openPalette(j.id);
  }

  const result = open?.result;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="size-5" />Brand Palette</CardTitle>
          <CardDescription>
            The Creative Director explores six colour directions, critiques them, and refines the best three, following the skills learned in Learn from YouTube. Contrast, shades and accessibility fixes are worked out in code from the hex codes, so they are exact.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={`grid gap-1 ${f.rows ? 'sm:col-span-2' : ''}`}>
                <Label className="font-normal text-muted-foreground">{f.label}</Label>
                {f.rows ? (
                  <Textarea rows={f.rows} value={brief[f.key]} onChange={(e) => setBrief({ ...brief, [f.key]: e.target.value })} />
                ) : (
                  <Input value={brief[f.key]} onChange={(e) => setBrief({ ...brief, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
            {canWork && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button disabled={busy || !brief.name.trim()} onClick={generate}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Make palettes</Button>
                <Button variant="outline" onClick={() => setBrief({ ...brief, keep: CURRENT })}>Use current brand colours</Button>
                <Button variant="ghost" onClick={() => setBrief(DEFAULT_BRIEF)}>Reset</Button>
              </div>
            )}
            {msg && <div className="text-sm text-muted-foreground sm:col-span-2">{msg}</div>}
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">Made so far</div>
            {list.length === 0 && <div className="text-sm text-muted-foreground">None yet.</div>}
            {list.map((p) => (
              <div key={p.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${open?.id === p.id ? 'border-primary' : ''}`}>
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openPalette(p.id)} title={p.error || ''}>
                  {p.name} <span className="text-xs text-muted-foreground">#{p.id}</span>
                </button>
                <StatusBadge status={p.status === 'ready' ? 'approved' : p.status === 'failed' ? 'failed' : 'generating'}>{p.status}</StatusBadge>
                {canWork && <button type="button" title="Delete" onClick={() => window.confirm(`Delete palette #${p.id}?`) && fetch('/api/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: p.id }) }).then(() => { if (open?.id === p.id) setOpen(null); loadList(); })}><Trash2 className="size-3.5 text-muted-foreground" /></button>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {open && open.status === 'generating' && <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Making &quot;{open.name}&quot;. In Testing mode this waits for Claude Code (&quot;run the SEO AI queue&quot;).</CardContent></Card>}
      {open && open.status === 'failed' && <Card><CardContent className="py-6 text-sm text-destructive">This palette failed: {open.error}</CardContent></Card>}
      {result && (
        <>
          <Card>
            <CardHeader><CardTitle>Strategy</CardTitle><CardDescription>{open.name}{open.parent_id ? ` · refined from #${open.parent_id}` : ''} · {open.created_at} UTC{result.skillsUsed?.length ? '' : ' · made before any skill was learned'}</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{result.strategy}</p>
              {result.dropped?.length > 0 && <div className="text-xs text-muted-foreground">Explored and dropped: {result.dropped.join(' · ')}</div>}
            </CardContent>
          </Card>
          {result.directions.map((d: any, i: number) => <Direction key={`${open.id}-${i}`} d={d} i={i} palette={open} canWork={canWork} onDone={(m) => { setMsg(m); loadList(); openPalette(open.id); }} />)}
        </>
      )}
    </div>
  );
}

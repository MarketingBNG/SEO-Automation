'use client';

// Settings > Blog rules: the call to action for each service, how many keywords SE Ranking should
// track, and what the dashboard has learned.
import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_CTAS, type ServiceCta } from '@/lib/strategy/core';
import { StartedCountdown } from './countdown';

export function BlogRulesCard({ canChange }: { canChange: boolean }) {
  const [ctas, setCtas] = useState<ServiceCta[]>(DEFAULT_CTAS);
  const [target, setTarget] = useState('1500');
  const [lessons, setLessons] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  // Both jobs run on the server in the background; this polls until they finish.
  async function runNow(kind: 'lessons' | 'topup') {
    const url = kind === 'lessons' ? '/api/lessons' : '/api/seranking/topup';
    setRunning(kind);
    setMsg(kind === 'lessons' ? 'Learning from the latest results on the server. You can leave this page.' : 'Adding keywords on the server. You can leave this page; the timer at the top shows the time left.');
    try {
      const res = await fetch(url, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await fetch(url).then((r) => r.json()).catch(() => null);
        if (!st || st.running) continue;
        if (kind === 'lessons') {
          setLessons(st.lessons || '');
          setMsg('Lessons updated.');
        } else {
          const l = st.last || {};
          setMsg(l.error ? `Could not add keywords: ${l.error}` : l.skipped || `${l.added} keyword(s) added (${l.strategyAdded || 0} from the strategy). SE Ranking now tracks ${l.tracked} of the ${l.target} target.${l.researchSkipped ? ' Keyword research was skipped to keep SE Ranking credits for blogs.' : ''}`);
        }
        break;
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setRunning(null);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const bad = ctas.find((c) => !c.service.trim() || !c.text.trim() || !/^https?:\/\//.test(c.url));
      if (bad) throw new Error('Every call to action needs a service, a sentence and a link starting with https://.');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_ctas: JSON.stringify(ctas), tracked_keyword_target: String(Math.max(20, Math.min(5000, Number(target) || 1500))) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setMsg('Saved.');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setCta = (i: number, patch: Partial<ServiceCta>) => setCtas((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Blog rules</CardTitle>
        <CardDescription>The call to action for each service, how many keywords are tracked, and what the dashboard has learned.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <fieldset disabled={!canChange} className="grid gap-5">
          <div className="grid gap-2">
            <div className="font-semibold">Call to action for each service</div>
            <p className="text-muted-foreground">Each blog gets the call to action of the service it is about (matched on the words in &quot;Matches&quot;). The writer turns the idea into a closing line written for that article, and the link carries UTM tags so Zoho shows which blog the lead came from.</p>
            {ctas.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-2 md:grid-cols-[160px_1fr_1fr_auto]">
                <Input className="h-8" value={c.service} onChange={(e) => setCta(i, { service: e.target.value })} placeholder="Service" aria-label="Service" />
                <Input className="h-8" value={c.text} onChange={(e) => setCta(i, { text: e.target.value })} placeholder="Call to action idea" aria-label="Call to action" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input className="h-8" value={c.url} onChange={(e) => setCta(i, { url: e.target.value })} placeholder="https://usaindiacfo.com/..." aria-label="Link" />
                  <Input className="h-8" value={c.match} onChange={(e) => setCta(i, { match: e.target.value })} placeholder="Matches, e.g. itin|w-7" aria-label="Matches" />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCtas((l) => l.filter((_, j) => j !== i))} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div>
              <Button size="sm" variant="outline" onClick={() => setCtas((l) => [...l, { service: '', match: '', text: '', url: 'https://usaindiacfo.com/contact-us/' }])}>
                <Plus /> Add a service
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="font-semibold">Keywords tracked in SE Ranking</div>
            <p className="text-muted-foreground">Tracking follows the approved strategy. Every keyword in it is tracked as soon as it is approved or edited. Each week up to 500 more are added until the project tracks this many, only on the strategy's topics: Search Console searches we already appear for (no credits), then keyword research seeded from the strategy's keywords for the US and India (SE Ranking API credits, only above the reserve kept for blog research). The next strategy is built from these rankings. Your plan allows up to 5,000 tracked keywords.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-32" type="number" min={20} max={5000} value={target} onChange={(e) => setTarget(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!!running} onClick={() => runNow('topup')}>
                {running === 'topup' && <Loader2 className="animate-spin" />} Add missing keywords now
              </Button>
              {running === 'topup' && <StartedCountdown seconds={180} className="text-xs" />}
            </div>
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={!canChange || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save blog rules
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>

        <div className="grid gap-1">
          <div className="font-semibold">What the dashboard has learned</div>
          <p className="text-muted-foreground">Updated every week from reviewers&apos; rejections, blogs the checks held, fact-check corrections and how published posts performed. The writer follows these on every new blog.</p>
          <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2">{lessons || 'Nothing learned yet. The first lessons are written after the first week of reviews and results.'}</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!canChange || !!running} onClick={() => runNow('lessons')}>
              {running === 'lessons' && <Loader2 className="animate-spin" />} Learn from the latest results now
            </Button>
            {running === 'lessons' && <StartedCountdown seconds={120} className="text-xs" />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

// Settings > Blog rules: the CA/CPA reviewers who sign off tax blogs, whether those blogs must wait
// for them, the call to action for each service, and how many keywords SE Ranking should track.
import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_CTAS, type ServiceCta } from '@/lib/strategy/core';
import { StartedCountdown } from './countdown';

export function BlogRulesCard({ canChange }: { canChange: boolean }) {
  const [reviewers, setReviewers] = useState('');
  const [requireExpert, setRequireExpert] = useState(true);
  const [ctas, setCtas] = useState<ServiceCta[]>(DEFAULT_CTAS);
  const [target, setTarget] = useState('400');
  const [lessons, setLessons] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  async function runNow(kind: 'lessons' | 'topup') {
    setRunning(kind);
    setMsg(null);
    try {
      const res = await fetch(kind === 'lessons' ? '/api/lessons' : '/api/seranking/topup', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (kind === 'lessons') {
        if (j.lessons) setLessons(j.lessons);
        setMsg(j.skipped || 'Lessons updated.');
      } else {
        setMsg(j.skipped || `${j.added} keyword(s) added. SE Ranking now tracks ${j.tracked} of the ${j.target} target.`);
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setRunning(null);
    }
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        setReviewers(s.expert_reviewers || s.byline_reviewer || '');
        setRequireExpert(s.require_expert_review !== '0');
        setTarget(s.tracked_keyword_target || '400');
        setLessons(s.writer_lessons || '');
        try {
          const list = JSON.parse(s.service_ctas || '[]');
          if (Array.isArray(list) && list.length) setCtas(list);
        } catch {}
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const bad = ctas.find((c) => !c.service.trim() || !c.text.trim() || !/^https?:\/\//.test(c.url));
      if (bad) throw new Error('Every call to action needs a service, a sentence and a link starting with https://.');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expert_reviewers: reviewers.trim(), require_expert_review: requireExpert ? '1' : '0', service_ctas: JSON.stringify(ctas), tracked_keyword_target: String(Math.max(20, Math.min(2000, Number(target) || 400))) }),
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
        <CardDescription>Who signs off tax blogs, the call to action for each service, and how many keywords are tracked.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <fieldset disabled={!canChange} className="grid gap-5">
          <div className="grid gap-2">
            <div className="font-semibold">CA/CPA reviewers</div>
            <p className="text-muted-foreground">One per line, as &quot;Name, credential&quot; (for example &quot;Akshay Nahar, CA&quot;). Their name and the review date appear on every post they approve, with expert schema for Google.</p>
            <textarea className="min-h-20 rounded-md border bg-background p-2" value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder={'Akshay Nahar, CA\nName, CPA'} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={requireExpert} onChange={(e) => setRequireExpert(e.target.checked)} />
              Tax, legal and compliance blogs wait for a reviewer&apos;s approval and never publish on their own
            </label>
          </div>

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
            <p className="text-muted-foreground">Every week the dashboard adds the most useful missing keywords (strategy keywords, Search Console queries and keyword research for the US and India) until the project tracks this many. More keywords use more SE Ranking credits.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-32" type="number" min={20} max={2000} value={target} onChange={(e) => setTarget(e.target.value)} />
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

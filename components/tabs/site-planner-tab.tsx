'use client';

// Website Planner (temporary, admin only): pages, sections, tabs and copy for the new website,
// from the dashboard's data and competitor research. Downloads as Word.
import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Wand2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { SafeHtml } from '@/components/shared/article';
import { jobsChanged } from '@/components/shared/job-progress';

const fmt = (s?: string) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');

export default function SitePlannerTab() {
  const [d, setD] = useState<any>(null);
  const [brief, setBrief] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/site-planner');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || `HTTP ${r.status}`);
    else setD(j);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  const running = d?.status?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [running, load]);
  async function make() {
    setErr(null);
    const r = await fetch('/api/site-planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error || `HTTP ${r.status}`);
    jobsChanged();
    setTimeout(load, 1500);
  }
  if (err && !d) return <p className="text-sm text-destructive">{err}</p>;
  if (!d) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</div>;
  const p = d.plan;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Website Planner (temporary)</CardTitle>
          <CardDescription>
            Plans the new website: the pages, the sections on each page in order, the navigation tabs and the full copy, starting with a hero line that explains the business. It uses the dashboard&apos;s data (Google searches and pages, the strategy&apos;s keywords, the services, the current site&apos;s pages) and research on competitors&apos; sites. Only the admin sees this section; it closes on {fmt(d.closesAt)}. Download the Word file before then.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={3} placeholder="Notes for the plan (optional): pages you want, sections like Events or Testimonials, tone, competitors to look at" value={brief} onChange={(e) => setBrief(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={make} disabled={running}>{running ? <Loader2 className="animate-spin" /> : <Wand2 />}{running ? 'Planning (10 to 20 minutes)…' : p ? 'Make a new plan' : 'Make the plan'}</Button>
            {p && <a className={buttonVariants({ variant: 'outline' })} href="/api/site-planner/download" download><Download />Download Word</a>}
            {d.status?.state === 'failed' && <span className="text-sm text-destructive">Last run failed: {d.status.error}</span>}
            {err && <span className="text-sm text-destructive">{err}</span>}
          </div>
        </CardContent>
      </Card>
      {p && (
        <Card>
          <CardHeader>
            <CardTitle>{p.hero?.headline}</CardTitle>
            <CardDescription>{p.hero?.subline} · Buttons: {p.hero?.primaryCta}{p.hero?.secondaryCta ? ` / ${p.hero.secondaryCta}` : ''}. Made {fmt(p.madeAt)}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {p.hero?.why && <p className="text-muted-foreground">Why this line: {p.hero.why}</p>}
            <div><strong>Tabs:</strong> {(p.navigation || []).map((n: any) => n.tab).join(' · ')}</div>
            {(p.pages || []).map((pg: any) => (
              <details key={pg.slug || pg.name} className="rounded-lg border p-2">
                <summary className="cursor-pointer font-medium">{pg.name} <span className="text-xs text-muted-foreground">{pg.slug} · {(pg.sections || []).length} sections</span></summary>
                <p className="mt-1 text-muted-foreground">{pg.purpose}</p>
                {(pg.sections || []).map((s: any, i: number) => (
                  <div key={i} className="mt-2 border-t pt-2">
                    <div className="font-medium">{i + 1}. {s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.purpose}{s.layout ? ` · ${s.layout}` : ''}</div>
                    <SafeHtml className="prose-article mt-1 text-sm" html={s.content || ''} />
                  </div>
                ))}
              </details>
            ))}
            {p.notes?.length > 0 && <div><strong>The team must supply:</strong><ul className="ml-4 list-disc">{p.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

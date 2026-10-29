'use client';

// Learning: what the team changed in the blogs (and how much), what the writer has learned from
// it, and what the team asks the dashboard for. Read only.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Brain, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const KIND: Record<string, string> = { edit: 'Edit', upload: 'Word upload', reupload: 'Re-upload', optimise: 'Optimised', rewrite: 'Rewrite', restore: 'Restore' };
const fmt = (s?: string | null) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST' : '');
const ACTION: Record<string, string> = {
  'keywords.added': 'Keywords added for blogs',
  'keywords.uploaded': 'Keyword files uploaded',
  'draft.edited': 'Blog drafts edited',
  'draft.approved': 'Blogs approved',
  'draft.rejected': 'Blogs rejected',
  'audit.completed': 'Blogs checked',
  'audit.rewritten': 'Blogs rewritten',
  'topics.researched': 'Topic research runs',
  'schedule.approved': 'Calendar blogs approved',
  'schedule.rejected': 'Calendar blogs rejected',
  'schedule.paused': 'Calendar blogs paused',
  'schedule.rescheduled': 'Calendar blogs rescheduled',
  'draft.optimised': 'Blogs optimised for SEO, AEO and GEO',
  'site.content': 'Website content changes',
};

export default function LearningTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/learning');
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

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <Loader2 className="size-5 animate-spin" />;
  const link = (c: any) => (c.entity_type === 'draft' ? `/?tab=drafts&draft=${c.entity_id}` : `/?tab=audit`);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Brain className="size-5" /> Learning</CardTitle>
          <CardDescription>
            The dashboard watches what the team changes in its blogs and what it asks for, and learns from it. Every edit, Word upload, re-upload, optimisation and restore is recorded with what changed and how much. Once a day the edits become lessons in the writer&apos;s memory, so the next blog needs less changing. A re-uploaded piece is compared with the earlier upload and its changed claims are verified first.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the team changed</CardTitle>
          <CardDescription>Newest first. Open a blog to see each change in detail.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No change recorded yet. Changes are recorded from now on.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.changes.map((c: any) => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link className="font-medium underline" href={link(c)}>{c.title || `${c.entity_type} ${c.entity_id}`}</Link>
                    <span className="text-xs text-muted-foreground">{KIND[c.kind] || c.kind} by {c.actor || 'someone'}, {fmt(c.created_at)}, {c.changed_pct}% of the text</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{c.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the writer has learned</CardTitle>
          <CardDescription>
            From the team&apos;s edits (daily{data.lessons.lastEditLearning ? `, last ${fmt(data.lessons.lastEditLearning)}` : ', nothing learned yet'}), from reviews and results (weekly), and from the team&apos;s own rules. The writer reads these before every blog.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="mb-1 font-medium">From the team&apos;s edits</div>
            {data.lessons.fromEdits.length ? <ul className="ml-5 list-disc space-y-1">{data.lessons.fromEdits.map((m: any) => <li key={m.id}>{m.body}{m.strength > 1 ? <span className="text-xs text-muted-foreground"> (seen {m.strength} times)</span> : null}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing yet. Lessons appear the day after the first edits are recorded.</p>}
          </div>
          <div>
            <div className="mb-1 font-medium">From reviews, holds, corrections and results</div>
            {data.lessons.weekly.length ? <ul className="ml-5 list-disc space-y-1">{data.lessons.weekly.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing yet. These are learned every Monday.</p>}
          </div>
          {data.lessons.other.length > 0 && (
            <div>
              <div className="mb-1 font-medium">Other memory (rules, mistakes, facts)</div>
              <ul className="ml-5 list-disc space-y-1">{data.lessons.other.slice(0, 15).map((m: any) => <li key={m.id}><span className="text-xs text-muted-foreground">[{m.kind}] </span>{m.body}</li>)}</ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the team asks for</CardTitle>
          <CardDescription>The last {data.searches.sinceDays} days: keywords researched, topics taken up, questions to the Assistant, and what people did most.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="mb-1 font-medium">Keywords researched ({data.searches.keywords.length})</div>
            {data.searches.keywords.length ? <ul className="space-y-0.5 text-xs">{data.searches.keywords.map((k: any, i: number) => <li key={i}>{k.keyword} <span className="text-muted-foreground">({k.batch_name || 'blog'}, {k.status})</span></li>)}</ul> : <p className="text-xs text-muted-foreground">None.</p>}
          </div>
          <div>
            <div className="mb-1 font-medium">Topics taken up ({data.searches.topics.length})</div>
            {data.searches.topics.length ? <ul className="space-y-0.5 text-xs">{data.searches.topics.map((t: any, i: number) => <li key={i}>{t.title} <span className="text-muted-foreground">({t.status}{t.pillar ? `, ${t.pillar}` : ''}, {t.day})</span></li>)}</ul> : <p className="text-xs text-muted-foreground">None.</p>}
          </div>
          <div>
            <div className="mb-1 font-medium">Questions to the Assistant ({data.searches.questions.length})</div>
            {data.searches.questions.length ? <ul className="space-y-0.5 text-xs">{data.searches.questions.map((q: any, i: number) => <li key={i}>{q.title || '(untitled chat)'} <span className="text-muted-foreground">{q.by ? `by ${q.by}` : ''}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">None.</p>}
          </div>
          <div>
            <div className="mb-1 font-medium">What people did most</div>
            {data.searches.actions.length ? <ul className="space-y-0.5 text-xs">{data.searches.actions.map((a: any) => <li key={a.action}>{ACTION[a.action] || a.action}: {a.count}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing recorded.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

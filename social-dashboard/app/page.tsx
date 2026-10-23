import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { calendar, news, stats, trends } from '@/lib/mock';

const PIPELINE = ['Research', 'Strategy (Gate 1)', 'Calendar (Gate 2)', 'Create', 'Final approval (Gate 3)', 'Publish', 'Replies', 'Learn'];

export default function Overview() {
  return (
    <>
      <PageHeader title="Overview" description="Claude leads the AI team; a person approves at every gate. Sample data until APIs are connected." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-3xl font-bold text-[#1B2A5E] dark:text-white">{s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.note}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          {PIPELINE.map((p, i) => (
            <span key={p} className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 ${p.includes('Gate') ? 'bg-[#E8B04B] font-medium text-[#0B1430]' : 'bg-[#1B2A5E] text-white'}`}>{p}</span>
              {i < PIPELINE.length - 1 && <span className="text-muted-foreground">→</span>}
            </span>
          ))}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Urgent news waiting</CardTitle>
            <Link href="/news" className="text-xs text-primary underline">Open</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {news.filter((n) => n.status === 'pending').map((n) => (
              <div key={n.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">{n.headline}</div>
                <div className="mt-1 text-xs text-muted-foreground">{n.time} · {n.source} · {n.format}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Top trends today</CardTitle>
            <Link href="/research" className="text-xs text-primary underline">Open</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {trends.slice(0, 4).map((t) => (
              <div key={t.topic} className="flex items-center justify-between gap-3 text-sm">
                <span>{t.topic}</span>
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">{t.score}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>This week</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {calendar.slice(0, 5).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="w-24 text-muted-foreground">{c.date}</span>
              <span className="flex-1">{c.topic}</span>
              <span className="text-xs text-muted-foreground">{c.platform}</span>
              <StatusBadge status={c.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

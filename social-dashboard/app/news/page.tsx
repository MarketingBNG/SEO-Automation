import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { ReviewActions } from '@/components/review-actions';
import { news } from '@/lib/mock';

export default function News() {
  return (
    <>
      <PageHeader title="24/7 News" description="Scanned every 30-60 minutes (Grok, IRS, CBDT, SEC, RBI, Federal Register). Creatives are made at once and need fast approval." />
      <div className="space-y-3">
        {news.map((n) => (
          <Card key={n.id}>
            <CardContent className="grid gap-3 pt-5 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${n.urgency === 'High' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{n.urgency}</span>
                  <span className="text-xs text-muted-foreground">{n.time} · {n.source}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{n.headline}</div>
                <div className="text-xs text-muted-foreground">Ready: {n.format} · fact-checked on the official source</div>
              </div>
              <ReviewActions initial={n.status} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

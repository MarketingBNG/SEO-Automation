import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { ReviewActions } from '@/components/review-actions';
import { replies } from '@/lib/mock';

export default function Replies() {
  return (
    <>
      <PageHeader title="Replies" description="Professional English, fact-checked on official sources and Fireflies meetings, human-like timing. Tax, pricing and legal questions go to a person." />
      <div className="space-y-3">
        {replies.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-2 pt-5 text-sm">
              <div className="text-xs text-muted-foreground">{r.platform} · {r.from} · <b>{r.route}</b></div>
              <div className="rounded-md bg-muted p-3">“{r.message}”</div>
              <div className="rounded-md border-l-4 border-[#E8B04B] p-3">{r.draft}</div>
              <div className="text-xs text-emerald-700">{r.checks}</div>
              <ReviewActions editLabel="Edit reply" />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

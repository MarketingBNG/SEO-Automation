import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { ReviewActions } from '@/components/review-actions';
import { calendar } from '@/lib/mock';

export default function Calendar() {
  return (
    <>
      <PageHeader title="Content Calendar" description="Gate 2. Every item can be approved, edited, or rejected with a comment. Built from the approved strategy." />
      <div className="space-y-3">
        {calendar.map((c) => (
          <Card key={c.id}>
            <CardContent className="grid gap-3 pt-5 md:grid-cols-[110px_1fr_auto] md:items-center">
              <div className="text-sm font-medium text-[#1B2A5E] dark:text-white">{c.date}</div>
              <div>
                <div className="text-sm font-medium">{c.topic}</div>
                <div className="text-xs text-muted-foreground">{c.platform} · {c.person} · {c.format}</div>
              </div>
              <ReviewActions initial={c.status} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

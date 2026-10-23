import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { ReviewActions } from '@/components/review-actions';
import { content } from '@/lib/mock';

export default function ContentReview() {
  return (
    <>
      <PageHeader title="Content Review" description="Gate 3. See the final post as it will appear. Approve, edit by prompt, or reject with a comment." />
      <div className="grid gap-6 lg:grid-cols-3">
        {content.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <div className="flex aspect-square items-center justify-center rounded-t-xl bg-[#0B1430] p-6 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#E8B04B]">{c.format} preview</div>
                <div className="mt-2 text-xl font-bold leading-tight text-white">{c.title}</div>
                <div className="mt-4 text-xs text-white/60">USAIndiaCFO</div>
              </div>
            </div>
            <CardHeader><CardTitle className="text-sm">{c.platform}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
              <p className="text-sm text-muted-foreground">{c.caption}</p>
              <div className={`text-xs ${c.factCheck.startsWith('Passed') ? 'text-emerald-700' : 'text-amber-700'}`}>Fact check: {c.factCheck}</div>
              <ReviewActions initial={c.status} editLabel="Edit by prompt" />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

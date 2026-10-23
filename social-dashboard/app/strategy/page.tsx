import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { ReviewActions } from '@/components/review-actions';
import { strategy } from '@/lib/mock';

export default function Strategy() {
  return (
    <>
      <PageHeader title={`Monthly Strategy: ${strategy.month}`} description="Gate 1. Approve, edit, or reject with a comment; a rejected strategy is rebuilt from your comment." />
      <Card className="mb-6">
        <CardContent className="pt-5"><ReviewActions initial={strategy.status} /></CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Goals</CardTitle></CardHeader>
          <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{strategy.goals.map((g) => <li key={g}>{g}</li>)}</ul></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Themes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {strategy.themes.map((t) => (
              <div key={t.name} className="text-sm">
                <div className="flex justify-between"><span>{t.name}</span><span className="font-medium">{t.share}</span></div>
                <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-[#E8B04B]" style={{ width: t.share }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Posts per week</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {strategy.mix.map((m) => (
              <div key={m.platform} className="flex justify-between"><span>{m.platform}</span><span className="font-medium">{m.perWeek}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { lessons, skills } from '@/lib/mock';

export default function Learning() {
  return (
    <>
      <PageHeader title="Learning & Skills" description="Every week the system learns from approvals, rejections, edits, reach and leads. No manual retraining." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Lessons learned</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {lessons.map((l) => (
              <div key={l.lesson} className="py-3 text-sm">
                <div className="text-xs text-muted-foreground">{l.week}</div>
                {l.lesson}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Skill library</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {skills.map((s) => <span key={s} className="rounded-full bg-[#1B2A5E] px-3 py-1 text-xs text-white">{s}</span>)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

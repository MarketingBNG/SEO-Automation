import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { trends } from '@/lib/mock';

const SOURCES = [
  ['Grok (xAI)', 'Live trends on X and the web, every 30-60 min'],
  ['Claude', 'Niche research, competitors, source checking'],
  ['SerpHouse + Search Console', '"People also ask" and what people search'],
  ['Fireflies', 'Real questions from client meetings'],
  ['WordPress', 'Our blogs to repurpose'],
  ['Own scraper', 'Reddit, Quora, competitor pages'],
];

export default function Research() {
  return (
    <>
      <PageHeader title="Research & Trends" description="Every finding keeps its source link. Feeds the monthly strategy and the 24/7 news engine." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Trending in our niche</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {trends.map((t) => (
              <div key={t.topic} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <div className="text-sm font-medium">{t.topic}</div>
                  <div className="text-xs text-muted-foreground">{t.source} · {t.age} ago</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-[#1B2A5E] dark:text-white">{t.score}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">relevance</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Research sources</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {SOURCES.map(([n, d]) => (
              <div key={n} className="text-sm">
                <div className="font-medium">{n}</div>
                <div className="text-xs text-muted-foreground">{d}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

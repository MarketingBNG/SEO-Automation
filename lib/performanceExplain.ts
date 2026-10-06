// @ts-nocheck -- reads the untyped performance report.
// "Why it changed" paragraph at the end of the Overall, SEO, AEO and GEO reports. Claude reads
// only the report's own numbers (plus which blogs were published in the period) and explains what
// improved and why, which block or page drove it, what did not improve and why, and what is causing
// problems. Saved per view and period so it is written once, not on every page view.
import prisma from './prisma';
import * as settings from './settings';
import { callClaude } from './anthropic';
import { cachedPerformance } from './performanceReport';

const VIEWS = ['overall', 'seo', 'aeo', 'geo'];

function slice(perf, view) {
  const pick = (b) => b && { status: b.status, headline: b.headline, kpis: b.kpis, losers: b.losers, gainers: b.gainers, tracked: b.tracked, technical: b.technical, sources: b.sources, overview: b.overview, content: b.content, notMeasurable: b.notMeasurable };
  const base = { ranges: perf.ranges, dataNotes: perf.dataNotes, sourceErrors: perf.errors };
  if (view === 'overall') return { ...base, overall: perf.overall, seo: pick(perf.seo), aeo: pick(perf.aeo), geo: pick(perf.geo) };
  return { ...base, [view]: pick(perf[view]) };
}

export async function explainPerformance(view: string, days = 28, { fresh = false } = {}) {
  if (!VIEWS.includes(view)) throw new Error('Unknown view');
  const perf = await cachedPerformance(days);
  const key = `perf_explain_${view}_${days}`;
  const basis = `${perf.ranges.current.startDate}_${perf.ranges.current.endDate}`;
  if (!fresh) {
    const saved = await settings.get(key);
    if (saved) {
      const j = JSON.parse(saved);
      if (j.basis === basis) return j;
    }
  }

  const published = await prisma.drafts.findMany({
    where: { status: 'published', updated_at: { gte: perf.ranges.previous.startDate } },
    select: { title: true, wp_post_url: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
    take: 40,
  });

  const system = `You explain a website's ${view === 'overall' ? 'SEO, AEO and GEO' : view.toUpperCase()} report for USAIndiaCFO's marketing team.
Write ONE paragraph of 120 to 220 words in plain English that covers, in this order:
1. what improved, by how much, and which block (KPI, page or keyword group) drove it, and the most likely reason;
2. what did not improve or fell, which block, and why;
3. what is causing problems right now and the one or two things to do about them.
RULES: use only the numbers in the data. Never invent a number, a page or a cause. When the data
cannot show why something changed, say so plainly (for example "the data does not show the cause").
Respect the data notes (for example impressions not comparable across a reporting change). Name pages
and KPIs exactly as given. No em dashes, no hype, no headings, no bullet points.`;
  const user = `Report data (JSON):\n${JSON.stringify(slice(perf, view)).slice(0, 60000)}\n\nBlogs published or updated since ${perf.ranges.previous.startDate}:\n${published.map((p) => `- ${p.title} (${p.wp_post_url}) ${p.updated_at}`).join('\n') || 'none recorded'}`;
  const { text } = await callClaude(system, [{ role: 'user', content: user }], undefined, { maxUses: 1, effort: 'high' });
  const paragraph = text.replace(/—/g, ', ').replace(/\s+\n/g, '\n').trim();
  const out = { basis, view, days, text: paragraph, writtenAt: new Date().toISOString() };
  await settings.set(key, JSON.stringify(out));
  return out;
}

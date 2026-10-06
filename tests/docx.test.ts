// The Word report must open in Microsoft Word: every picture needs its own drawing id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { htmlToDocx } from '../lib/docx';
import { renderPerformanceHtml } from '../lib/performanceDoc';

test('report with several charts has unique picture ids and valid XML', async () => {
  const L = ['08-01', '08-08', '08-15', '08-22'];
  const k = (label: string) => ({ label, now: 10, before: 8, changePct: 25, unit: '', note: 'n' });
  const block = { kpis: [k('A'), k('B')], series: { labels: L, clicks: [1, 2, 3, 4], nonBrandedClicks: [1, 1, 2, 2], organicVisits: [3, 4, 5, 6], questionClicks: [1, 2, 1, 2], aiVisits: [0, 1, 1, 2], brandClicks: [1, 1, 1, 1] } };
  const p = {
    generatedAt: new Date().toISOString(),
    ranges: { current: { startDate: '2026-09-07', endDate: '2026-10-04' }, previous: { startDate: '2026-08-10', endDate: '2026-09-06' } },
    overall: { items: [{ pillar: 'SEO', status: 'good', headline: 'Clicks up & stable' }] },
    dataNotes: ['Note & detail'],
    seo: { ...block, topPages: [{ page: 'https://usaindiacfo.com/a?x=1&y=2', clicks: 5, before: 3 }], losers: [], tracked: null },
    aeo: { ...block, topQuestions: [{ query: 'what is fbar?', impressions: 10, clicks: 1, position: 4 }], notMeasurable: 'x' },
    geo: { ...block, sources: [{ source: 'chatgpt.com', sessions: 3 }], overview: null, notMeasurable: 'y' },
  };
  const buf = await htmlToDocx(await renderPerformanceHtml(p), { title: 'Test' });
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
  const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4, `picture ids must be unique, got ${ids.join(',')}`);
});

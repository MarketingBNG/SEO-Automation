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

test('page settings are moved to the end of the body and table settings are in Word order', async () => {
  const { moveSectPrToEnd, fixTablePropsOrder } = await import('../lib/docx');
  const body = moveSectPrToEnd('<w:body>\n<w:sectPr><w:pgSz/></w:sectPr><w:p/></w:body>');
  assert.match(body, /<w:p\/><w:sectPr><w:pgSz\/><\/w:sectPr><\/w:body>$/);
  const tbl = fixTablePropsOrder('<w:tblPr><w:tblBorders><w:top/></w:tblBorders><w:tblCellSpacing w:w="0"/><w:jc w:val="center"/></w:tblPr>');
  assert.equal(tbl, '<w:tblPr><w:jc w:val="center"/><w:tblCellSpacing w:w="0"/><w:tblBorders><w:top/></w:tblBorders></w:tblPr>');
});

test('report files have no "undefined" margins, one table grid, and Word-order properties', async () => {
  const html = '<h1>R</h1><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><blockquote>q</blockquote>';
  const buf = await htmlToDocx(html, { margins: { top: 720, bottom: 720, left: 720, right: 720 } });
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
  assert.ok(!xml.includes('"undefined"'), 'no undefined attribute values');
  assert.equal((xml.match(/<w:tblGrid>/g) || []).length, 1, 'one grid per table');
  for (const b of xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/g) || []) {
    const i = b.indexOf('<w:spacing'), j = b.indexOf('<w:ind'), k = b.indexOf('<w:jc');
    if (i >= 0 && j >= 0) assert.ok(i < j, 'spacing before ind');
    if (i >= 0 && k >= 0) assert.ok(i < k, 'spacing before jc');
  }
  for (const b of xml.match(/<w:(?:tblBorders|tblCellMar)>[\s\S]*?<\/w:(?:tblBorders|tblCellMar)>/g) || []) {
    if (b.includes('<w:left') && b.includes('<w:bottom')) assert.ok(b.indexOf('<w:left') < b.indexOf('<w:bottom'), 'left before bottom');
  }
});

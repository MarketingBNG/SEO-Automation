import sharp from 'sharp';
// Word version of the SEO / GEO / AEO performance report, with the same graphs as the dashboard
// (drawn as SVG, converted to PNG with sharp so Word can show them).

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLORS = ['#1B2A5E', '#D7392E', '#5BB947', '#D4AF37', '#E85A2C'];

function chartSvg({ labels, series, width = 760, height = 260 }) {
  const pad = { l: 56, r: 16, t: 34, b: 30 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i) => pad.l + (labels.length > 1 ? (i / (labels.length - 1)) * w : w / 2);
  const y = (v) => pad.t + h - (v / max) * h;
  const grid = [0, 0.5, 1]
    .map((f) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#ddd"/><text x="${pad.l - 6}" y="${y(max * f) + 4}" font-size="11" text-anchor="end" fill="#555">${Math.round(max * f).toLocaleString('en-US')}</text>`)
    .join('');
  const xl = labels
    .map((l, i) => (i % 2 === 0 ? `<text x="${x(i)}" y="${height - 10}" font-size="10" text-anchor="middle" fill="#555">${esc(l)}</text>` : ''))
    .join('');
  const lines = series
    .map((s, k) => {
      const c = COLORS[k % COLORS.length];
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5"/>` + s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${c}"/>`).join('');
    })
    .join('');
  const legend = series
    .map((s, k) => `<rect x="${pad.l + k * 190}" y="10" width="10" height="10" fill="${COLORS[k % COLORS.length]}"/><text x="${pad.l + k * 190 + 15}" y="19" font-size="11" fill="#222">${esc(s.name)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${legend}${grid}${xl}${lines}</svg>`;
}

async function chartImg(spec) {
  const png = await sharp(Buffer.from(chartSvg(spec))).png().toBuffer();
  return `<p><img src="data:image/png;base64,${png.toString('base64')}" width="640" height="219" alt="${esc(spec.title)}"/></p>`;
}

const changeText = (k) => (k.changePct === null || k.changePct === undefined || k.now === k.before ? '' : `${k.changePct > 0 ? '+' : ''}${k.changePct}%`);
const STATUS = { good: 'Doing well', watch: 'Needs watching', bad: 'Needs attention', unknown: 'Not enough data' };

function table(headers, rows) {
  if (!rows.length) return '<p>None this period.</p>';
  return `<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const fmt = (n, unit) => `${Number(n).toLocaleString('en-US')}${unit || ''}`;
const kpiTable = (kpis) => table(['Measure', 'Now', 'Before', 'Change', 'Note'], kpis.map((k) => [k.label, fmt(k.now, k.unit), fmt(k.before, k.unit), changeText(k), k.note]));
const bullets = (a) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

async function renderPerformanceHtml(p) {
  const L = p.seo.series.labels || [];
  const out: any[] = [];
  out.push('<h1>SEO, AEO and GEO performance report</h1>');
  out.push(`<p>Period: ${esc(p.ranges.current.startDate)} to ${esc(p.ranges.current.endDate)}, compared with ${esc(p.ranges.previous.startDate)} to ${esc(p.ranges.previous.endDate)}. Generated ${esc(p.generatedAt.slice(0, 10))}.</p>`);
  out.push('<h2>Overall</h2>');
  out.push(table(['Area', 'Status', 'Summary'], p.overall.items.map((i) => [i.pillar, STATUS[i.status], i.headline])));
  if (p.dataNotes.length) out.push('<h3>Read this before reacting to a number</h3>' + bullets(p.dataNotes));

  out.push('<h2>SEO: rankings and search traffic</h2>' + kpiTable(p.seo.kpis));
  out.push(await chartImg({ title: 'Google clicks per week', labels: L, series: [{ name: 'All clicks', values: p.seo.series.clicks }, { name: 'Non-branded clicks', values: p.seo.series.nonBrandedClicks }] }));
  out.push(await chartImg({ title: 'Organic visits per week', labels: L, series: [{ name: 'Organic visits (GA4)', values: p.seo.series.organicVisits }] }));
  out.push('<h3>Top pages</h3>' + table(['Page', 'Clicks', 'Before'], p.seo.topPages.map((r) => [r.page, r.clicks, r.before])));
  out.push('<h3>Pages losing the most clicks</h3>' + table(['Page', 'Clicks', 'Before', 'Change'], p.seo.losers.map((r) => [r.page, r.clicks, r.before, r.change])));
  if (p.seo.tracked) {
    const d = p.seo.tracked.distribution;
    out.push(`<p>Tracked keywords: ${d.top3} in the top 3, ${d.top4to10} in positions 4-10, ${d.top11to20} in 11-20, ${d.top21to100} in 21-100, ${d.notRanked} not in the top 100.</p>`);
  }

  out.push('<h2>AEO: answer engines and questions</h2>' + kpiTable(p.aeo.kpis));
  out.push(await chartImg({ title: 'Question searches', labels: L, series: [{ name: 'Clicks', values: p.aeo.series.questionClicks }] }));
  out.push('<h3>Question searches we show up for</h3>' + table(['Search', 'Impressions', 'Clicks', 'Position'], p.aeo.topQuestions.map((r) => [r.query, r.impressions, r.clicks, r.position])));
  out.push(`<p>${esc(p.aeo.notMeasurable)}</p>`);

  out.push('<h2>GEO: generative AI answers</h2>' + kpiTable(p.geo.kpis));
  out.push(await chartImg({ title: 'Visits from AI assistants', labels: L, series: [{ name: 'AI visits', values: p.geo.series.aiVisits }, { name: 'Brand-name clicks', values: p.geo.series.brandClicks }] }));
  out.push('<h3>Where AI visits come from</h3>' + table(['Source', 'Visits'], p.geo.sources.map((s) => [s.source, s.sessions])));
  if (p.geo.overview?.rows?.length) out.push('<h3>Google AI Overviews for priority keywords</h3>' + table(['Keyword', 'AI Overview', 'Cites us'], p.geo.overview.rows.map((r) => [r.keyword, r.aiOverview ? 'yes' : 'no', r.citesUs ? 'yes' : 'no'])));
  out.push(`<p>${esc(p.geo.notMeasurable)}</p>`);
  return out.join('\n');
}

export { renderPerformanceHtml };

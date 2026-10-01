// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
// Renders a stored monthly strategy as a printable HTML document (used for the Word download),
// in the fixed section order the research recommends so every month reads the same way.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ul = (items) => (items && items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>None this month.</p>');

function table(headers, rows) {
  if (!rows || !rows.length) return '<p>None this month.</p>';
  return `<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const pctText = (v) => (v === null || v === undefined ? 'n/a' : `${v > 0 ? '+' : ''}${v}%`);

function renderReportHtml(strategy) {
  const report = strategy.report || {};
  const snap = strategy.data_snapshot || {};
  const a = snap.analysis || {};
  const mom = snap.monthOverMonth || {};
  const gsc = mom.searchConsole;
  const ga = mom.ga4;
  const nb = a.scoreboard?.nonBrandedClicks;
  const ai = a.aiVisibilitySummary;
  const parts: any[] = [];

  parts.push(`<h1>SEO and GEO strategy: ${esc(strategy.period)}</h1>`);
  parts.push(`<p><b>Status:</b> ${esc(String(strategy.status).replace('_', ' '))}. Generated ${esc(strategy.created_at)} UTC.</p>`);
  parts.push(`<h2>Summary</h2><p>${esc(report.summary || strategy.summary)}</p>`);

  parts.push('<h2>1. Data notes</h2>');
  parts.push(ul([...(a.dataHygiene || []).map((e) => `${e.start}${e.end ? ` to ${e.end}` : ' onward'}: ${e.note}`), ...(report.dataNotes || [])]));

  parts.push('<h2>2. Scoreboard</h2>');
  const rows: any[] = [];
  if (gsc) {
    rows.push(['Google clicks (all)', gsc.totals.now.clicks, gsc.totals.before.clicks, pctText(gsc.totals.change.clicksPct)]);
    rows.push(['Impressions', gsc.totals.now.impressions, gsc.totals.before.impressions, pctText(gsc.totals.change.impressionsPct)]);
  }
  if (nb) {
    rows.push(['Non-branded clicks, US', nb.now.US, nb.before.US, pctText(nb.changePct.US)]);
    rows.push(['Non-branded clicks, India', nb.now.India, nb.before.India, pctText(nb.changePct.India)]);
    rows.push(['Branded clicks', a.scoreboard.brandedClicks.now, a.scoreboard.brandedClicks.before, '']);
  }
  if (ga) {
    rows.push(['Organic sessions (GA4)', ga.organic.now.sessions, ga.organic.before.sessions, pctText(ga.organic.sessionsPct)]);
    rows.push(['Organic conversions (GA4)', ga.organic.now.conversions, ga.organic.before.conversions, pctText(ga.organic.conversionsPct)]);
  }
  if (mom.rankings?.distribution) {
    const d = mom.rankings.distribution;
    rows.push(['Tracked keywords in top 10 (SE Ranking)', `${d.top3 + d.top4to10} of ${mom.rankings.trackedKeywords}`, '', '']);
  }
  if (a.aiReferrals) rows.push(['Visits from AI assistants (ChatGPT, Gemini, Claude, Perplexity, Copilot)', a.aiReferrals.now.sessions, a.aiReferrals.before.sessions, pctText(a.aiReferrals.changePct)]);
  if (ai) rows.push(['AI Overview cites usaindiacfo.com', `${ai.citingUs} of ${ai.withAiOverview} with an AI Overview (${ai.checked} keywords checked)`, '', '']);
  parts.push(table(['Metric', 'This period', 'Previous', 'Change'], rows));
  if (gsc) parts.push(`<p>${esc(gsc.ranges.current.startDate)} to ${esc(gsc.ranges.current.endDate)} vs ${esc(gsc.ranges.previous.startDate)} to ${esc(gsc.ranges.previous.endDate)}.</p>`);
  parts.push(ul(report.scoreboardNotes));

  parts.push('<h2>3. Results of past work (cohorts)</h2>');
  for (const c of a.cohorts || []) {
    parts.push(`<h3>Published ${esc(c.label)}</h3>`);
    parts.push(table(['Post', 'Published', 'Clicks (28d)', 'Impressions (28d)', 'Position', 'On track'], c.posts.map((p) => [p.title, p.published, p.clicks28d, p.impressions28d, p.position ?? 'not ranking', p.onTrack ? 'yes' : 'no'])));
  }

  parts.push('<h2>4. Diagnosis</h2>');
  parts.push(ul(report.diagnosis));
  parts.push('<h3>Pages losing clicks</h3>');
  parts.push(table(['Page', 'Type', 'Clicks before', 'Clicks now', 'Position before', 'Position now'], (a.decay || []).map((d) => [d.page, d.type.replace(/_/g, ' '), d.clicksBefore, d.clicksNow, d.positionBefore, d.positionNow])));
  parts.push('<h3>Close to the top (striking distance)</h3>');
  parts.push(
    table(
      ['Query', 'Page', 'Position', 'Impressions', 'Extra clicks at #3 (per 28d)', 'Problem'],
      [...(a.strikingDistance?.clickProblems || []).map((s) => [s.query, s.page, s.position, s.impressions, s.potentialExtraClicks, 'click']), ...(a.strikingDistance?.rankingProblems || []).map((s) => [s.query, s.page, s.position, s.impressions, s.potentialExtraClicks, 'ranking'])]
    )
  );
  parts.push('<h3>Our pages competing for the same query</h3>');
  parts.push(table(['Query', 'Pages (share of impressions, position)'], (a.cannibalization || []).map((c) => [c.query, c.pages.map((p) => `${p.page} (${p.share}%, ${p.position})`).join('; ')])));
  parts.push('<h3>Posts to update for the Income-tax Act 2025</h3>');
  parts.push(table(['Post', 'Still says', 'Last modified', 'Clicks (28d)'], (a.regulatoryRefresh || []).map((r) => [r.title, r.example, r.lastModified, r.clicks28d])));

  parts.push("<h2>5. This month's picks</h2>");
  parts.push('<p>Priority = Extra clicks over 12 months x Business value x Deadline factor x Confidence / Effort. At most two Income-tax Act 2025 rewrites are placed first.</p>');
  if (report.planChecks?.length) parts.push('<p><b>Plan checks:</b></p>' + ul(report.planChecks));
  const pickRows = (list, prefix) =>
    (list || []).map((p, i) => [
      `${prefix}${i + 1}`,
      `${p.workingTitle || p.keyword}${p.targetUrl ? ` (${p.targetUrl})` : ''}`,
      p.action,
      p.format,
      p.score.priority,
      `${p.score.trafficPotential} clicks/12 mo${p.score.trafficPotentialSource === 'estimate' ? ' (est.)' : ''} x BV ${p.score.businessValue} x DF ${p.score.deadlineFactor} x C ${p.score.confidence} / E ${p.score.effort}`,
      `${p.why} Adds: ${p.addsBeyondTop5}`,
    ]);
  const pickHeaders = ['#', 'Pick', 'Action', 'Format', 'Priority', 'Inputs', 'Why'];
  parts.push(table(pickHeaders, pickRows(report.picks, '')));
  if (report.quickEdits?.length) {
    parts.push('<h3>Quick-edit track (outside the 8 slots)</h3>');
    parts.push(table(pickHeaders, pickRows(report.quickEdits, 'Q')));
  }
  if (report.nextInLine?.length) {
    parts.push('<h3>Next in line</h3>');
    parts.push(table(pickHeaders, pickRows(report.nextInLine, 'N')));
  }
  if (report.quickWins?.length) parts.push('<h3>Other quick wins</h3>' + ul(report.quickWins));

  parts.push('<h2>6. Consolidation and redirects</h2>');
  parts.push(table(['Query', 'Keep', 'Merge and 301', 'Reason'], (report.consolidation || []).map((c) => [c.query, c.keepUrl, c.mergeUrl, c.reason])));

  parts.push('<h2>7. Technical fixes</h2>');
  parts.push(table(['Fix', 'Impact', 'Effort', 'Evidence'], (report.technical || []).map((t) => [t.fix, t.impact, t.effort, t.evidence])));

  parts.push('<h2>8. AI search (GEO) and authority</h2>');
  if (a.aiVisibility?.length) {
    parts.push(table(['Keyword', 'AI Overview', 'Cites us', 'Our position', 'Cited sites'], a.aiVisibility.filter((r) => !r.error).map((r) => [r.keyword, r.aiOverview ? 'yes' : 'no', r.citesUs ? 'yes' : 'no', r.organicPosition ?? 'not in top results', r.citedSites.join(', ')])));
  }
  if (a.aiReferrals?.now?.sessions) {
    parts.push('<h3>Visits from AI assistants (28 days)</h3>');
    parts.push(table(['Source', 'Sessions', 'Conversions'], Object.entries(a.aiReferrals.now.bySource).map(([k, v]) => [k, v.sessions, v.conversions])));
  }
  if (a.questionBank?.newQuestions?.length) {
    parts.push(`<h3>New Google questions this month (${a.questionBank.newCount})</h3>`);
    parts.push(table(['Question', 'Found for keyword', 'Market'], a.questionBank.newQuestions.map((q) => [q.question, q.keyword, q.markets])));
  }
  parts.push('<h3>GEO actions</h3>' + ul(report.geo));
  parts.push('<h3>Authority actions</h3>' + ul(report.authority));
  parts.push('<h3>Competitors</h3>');
  parts.push(table(['Domain', 'What works', 'Gap for us'], (report.competitors || []).map((c) => [c.domain, c.whatWorks, c.gap])));

  parts.push('<h2>9. Risks and open questions</h2>');
  parts.push(ul(report.risks));
  parts.push('<h3>What cannot be measured yet</h3>' + ul(report.measurementGaps));

  if (a.deadlines?.length) {
    parts.push('<h2>Upcoming deadlines (confirm dates on the official calendar)</h2>');
    parts.push(table(['Date', 'Market', 'Deadline', 'Days away'], a.deadlines.map((d) => [d.date, d.market, d.what, d.daysAway])));
  }
  return parts.join('\n');
}

export { renderReportHtml };

// Fixed reference data for the monthly SEO strategy: the recurring US and India compliance
// deadlines that drive seasonal search demand, and the known Google data problems and updates
// that make some month-over-month comparisons misleading. Dates are the usual statutory dates;
// governments move them (India extends ITR dates often, and the Income-tax Act 2025 applies from
// Tax Year 2026-27), so the report always says to confirm against the official calendar.

const DEADLINES = [
  { month: 1, day: 15, market: 'US', what: 'Q4 estimated tax payment (Form 1040-ES)', topics: ['US estimated tax for NRIs and expats'] },
  { month: 3, day: 15, market: 'US', what: 'Partnership (Form 1065) and S-corp (Form 1120-S) returns, calendar year', topics: ['US partnership and S-corp filing'] },
  { month: 3, day: 15, market: 'India', what: 'Advance tax, 4th instalment (100%)', topics: ['advance tax for NRIs'] },
  {
    month: 4,
    day: 15,
    market: 'US',
    what: 'Form 1040 (with Form 8938), calendar-year Form 1120, Form 5472 with pro forma 1120 for foreign-owned single-member LLCs, FBAR (auto-extended to Oct 15), Q1 estimated tax',
    topics: ['FBAR filing', 'Form 5472 for foreign-owned US companies', 'US tax return with Indian income'],
  },
  { month: 6, day: 15, market: 'US', what: 'Automatic 2-month extension for US citizens living abroad; Q2 estimated tax', topics: ['US tax filing for Americans in India'] },
  { month: 6, day: 15, market: 'India', what: 'Advance tax, 1st instalment (15%)', topics: ['advance tax for NRIs'] },
  { month: 7, day: 15, market: 'India', what: 'RBI FLA return (foreign liabilities and assets) for companies with FDI or ODI', topics: ['FLA return for Indian subsidiaries'] },
  { month: 7, day: 31, market: 'India', what: 'Income tax return, non-audit cases (confirm each year: often extended)', topics: ['ITR filing for NRIs', 'DTAA relief claims'] },
  { month: 9, day: 15, market: 'US', what: 'Extended Form 1065 and 1120-S; Q3 estimated tax', topics: ['US estimated tax for NRIs and expats'] },
  { month: 9, day: 15, market: 'India', what: 'Advance tax, 2nd instalment (45%)', topics: ['advance tax for NRIs'] },
  { month: 9, day: 30, market: 'India', what: 'Tax audit report (Form 26 under the Income-tax Rules 2026 for FY 2025-26, as reported)', topics: ['tax audit for Indian subsidiaries'] },
  { month: 10, day: 15, market: 'US', what: 'Extended Form 1040, extended FBAR, extended calendar-year Form 1120', topics: ['FBAR extension', 'Form 1120 and 5472 extension'] },
  { month: 10, day: 31, market: 'India', what: 'Income tax return, audit cases', topics: ['ITR for companies and audit cases'] },
  { month: 11, day: 30, market: 'India', what: 'Income tax return, transfer-pricing cases', topics: ['transfer pricing for US-India groups'] },
  { month: 12, day: 15, market: 'India', what: 'Advance tax, 3rd instalment (75%)', topics: ['advance tax for NRIs'] },
];

// The research's Deadline Factor. Work on an existing URL pays off 45-90 days ahead (1.2 inside 45
// days). A new URL needs 90-180 days to rank, so under 90 days it gets no boost. For 30 days after a
// deadline, interest collapses. daysAway is negative for a deadline that has passed.
function deadlineFactor(daysAway, { refresh = false }: any = {}) {
  if (daysAway < 0) return daysAway >= -30 ? 0.5 : 1.0;
  if (refresh) return daysAway <= 44 ? 1.2 : daysAway <= 90 ? 1.5 : 1.0;
  return daysAway >= 90 && daysAway <= 180 ? 1.5 : 1.0;
}

function upcomingDeadlines(today = new Date(), horizonDays = 180) {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return DEADLINES.map((d) => {
    let date = Date.UTC(today.getUTCFullYear(), d.month - 1, d.day);
    if (date < base) date = Date.UTC(today.getUTCFullYear() + 1, d.month - 1, d.day);
    const daysAway = Math.round((date - base) / day);
    return { ...d, date: new Date(date).toISOString().slice(0, 10), daysAway, factorNewPage: deadlineFactor(daysAway), factorRefresh: deadlineFactor(daysAway, { refresh: true }) };
  })
    .filter((d) => d.daysAway <= horizonDays)
    .sort((a, b) => a.daysAway - b.daysAway);
}

// Google-confirmed data problems and ranking updates (Search Console data anomalies page and the
// Search Status Dashboard). `affects` says which metrics are unreliable in that window.
const DATA_EVENTS = [
  {
    start: '2025-05-13',
    end: '2026-04-27',
    kind: 'anomaly',
    affects: ['impressions', 'ctr', 'position'],
    note: 'Search Console over-reported impressions (clicks unaffected). Compare impressions, CTR and position only for windows starting on or after 2026-04-28; use clicks for year-over-year.',
  },
  { start: '2025-08-26', end: '2025-09-22', kind: 'update', affects: ['rankings'], note: 'August 2025 spam update rollout.' },
  {
    start: '2025-09-10',
    end: '2025-09-14',
    kind: 'change',
    affects: ['impressions', 'position'],
    note: 'Google stopped supporting the num=100 results parameter: impressions fell and average position improved without any real ranking change.',
  },
  { start: '2025-12-11', end: '2025-12-29', kind: 'update', affects: ['rankings'], note: 'December 2025 core update rollout.' },
  { start: '2026-02-28', end: '2026-03-01', kind: 'anomaly', affects: ['export'], note: 'Two days missing from Search Console bulk data exports for some properties.' },
  { start: '2026-03-24', end: '2026-03-25', kind: 'update', affects: ['rankings'], note: 'March 2026 spam update.' },
  { start: '2026-03-27', end: '2026-04-08', kind: 'update', affects: ['rankings'], note: 'March 2026 core update rollout.' },
  { start: '2026-05-21', end: '2026-06-02', kind: 'update', affects: ['rankings'], note: 'May 2026 core update rollout.' },
  { start: '2026-06-24', end: '2026-06-26', kind: 'update', affects: ['rankings'], note: 'June 2026 spam update.' },
  { start: '2026-08-18', end: '2026-08-20', kind: 'update', affects: ['rankings'], note: 'August 2026 spam update.' },
  {
    start: '2026-09-24',
    end: null,
    kind: 'update',
    affects: ['rankings'],
    note: 'September 2026 spam update began rolling out: treat September numbers as provisional until a full week after Google says it is complete.',
  },
];

// Events that overlap either comparison window, so the report can warn before anyone reacts to a
// number that is an artefact of Google's logging or an update rather than the site.
// An open-ended event (end null: a permanent change, or an update still rolling out) only distorts
// a comparison whose earlier window starts before it and whose data reaches it.
function eventsAffecting(...rangeSets) {
  const hits = new Map();
  for (const ranges of rangeSets) {
    const windows = [ranges.current, ranges.previous].filter(Boolean);
    const earliest = windows.map((w) => w.startDate).sort()[0];
    const latest = windows.map((w) => w.endDate).sort().pop();
    for (const e of DATA_EVENTS) {
      const overlaps =
        e.end === null ? earliest < e.start && e.start <= latest : windows.some((w) => e.start <= w.endDate && e.end >= w.startDate);
      if (overlaps) hits.set(e.start + e.kind, e);
    }
  }
  return [...hits.values()];
}

// First day from which Search Console impressions, CTR and position are trustworthy again.
const RELIABLE_IMPRESSIONS_FROM = '2026-04-28';

export { DEADLINES, upcomingDeadlines, deadlineFactor, DATA_EVENTS, eventsAffecting, RELIABLE_IMPRESSIONS_FROM };

// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import { googleAuth } from './searchConsole';

function getAuth() {
  return googleAuth(['https://www.googleapis.com/auth/analytics.readonly']);
}

function getPropertyId() {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID is not set in .env');
  return id;
}

async function runReport(requestBody, { signal }: any = {}) {
  const auth = getAuth();
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;
  const propertyId = getPropertyId();

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GA4 API error: ${json.error?.message || res.status}`);
  }
  return json;
}

// Totals for a date range (GA4 date strings like "2026-09-01" or "28daysAgo"). organicOnly limits
// it to sessions from the "Organic Search" channel.
async function getSummaryForRange(startDate, endDate, { organicOnly = false, signal }: any = {}) {
  const json = await runReport({
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'engagementRate' },
    ],
    ...(organicOnly
      ? {
          dimensionFilter: {
            filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } },
          },
        }
      : {}),
  }, { signal });

  const row = json.rows?.[0]?.metricValues || [];
  return {
    activeUsers: Number(row[0]?.value || 0),
    sessions: Number(row[1]?.value || 0),
    conversions: Number(row[2]?.value || 0),
    engagementRate: Number(row[3]?.value || 0),
  };
}

// Overall totals for the last N days - active users, sessions, conversions, engagement rate.
async function getSummary(days = 28, { signal }: any = {}) {
  return getSummaryForRange(`${days}daysAgo`, 'today', { signal });
}

// Top landing pages by sessions for the last N days.
async function getTopLandingPages(days = 28, limit = 15, { signal }: any = {}) {
  const json = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'conversions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit,
  }, { signal });

  return (json.rows || []).map((r) => ({
    page: r.dimensionValues[0].value,
    sessions: Number(r.metricValues[0].value),
    activeUsers: Number(r.metricValues[1].value),
    conversions: Number(r.metricValues[2].value),
  }));
}

// Organic-search landing pages for a date range (sessions, engagement, conversions) - finds pages
// that bring search traffic but do not convert.
async function getOrganicLandingPages(startDate, endDate, limit = 25) {
  const json = await runReport({
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'landingPage' }],
    metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'conversions' }],
    dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit,
  });
  return (json.rows || []).map((r) => ({
    page: r.dimensionValues[0].value,
    sessions: Number(r.metricValues[0].value),
    engagementRate: Number(r.metricValues[1].value),
    conversions: Number(r.metricValues[2].value),
  }));
}

// Visits referred by AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude), by source and
// landing page. Google AI Overviews and AI Mode clicks are inside Organic Search and cannot be split.
const AI_SOURCE_REGEX = 'chatgpt\\.com|chat\\.openai\\.com|openai|perplexity|gemini\\.google|copilot|edgeservices\\.bing\\.com|claude\\.ai';
// Totals come from GA4's own TOTAL row on a source-only report, so they never depend on how many
// source x landing-page rows fit under the row limit. Landing pages come from a second report,
// sorted by sessions.
async function getAiReferrals(startDate, endDate, { signal }: any = {}) {
  const base = {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'conversions' }],
    dimensionFilter: {
      filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: AI_SOURCE_REGEX, caseSensitive: false } },
    },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  };
  const [sources, pages] = await Promise.all([
    runReport({ ...base, dimensions: [{ name: 'sessionSource' }], metricAggregations: ['TOTAL'], limit: 250 }, { signal }),
    runReport({ ...base, dimensions: [{ name: 'sessionSource' }, { name: 'landingPage' }], limit: 10 }, { signal }),
  ]);
  const metric = (r, i) => Number(r?.metricValues?.[i]?.value || 0);

  const bySource: any = {};
  for (const r of sources.rows || []) bySource[r.dimensionValues[0].value] = { sessions: metric(r, 0), conversions: metric(r, 2) };
  const listed = Object.values(bySource);
  const total = sources.totals?.[0];
  const sessions = total ? metric(total, 0) : listed.reduce((s, v) => s + v.sessions, 0);
  const conversions = total ? metric(total, 2) : listed.reduce((s, v) => s + v.conversions, 0);
  // More sources than rows returned: keep the per-source table adding up to the total.
  if ((sources.rowCount || 0) > listed.length) {
    bySource['(other sources)'] = {
      sessions: Math.max(0, sessions - listed.reduce((s, v) => s + v.sessions, 0)),
      conversions: Math.max(0, conversions - listed.reduce((s, v) => s + v.conversions, 0)),
    };
  }

  const topLandingPages = (pages.rows || []).map((r) => ({
    source: r.dimensionValues[0].value,
    landingPage: r.dimensionValues[1].value,
    sessions: metric(r, 0),
    engagedSessions: metric(r, 1),
    conversions: metric(r, 2),
  }));
  return { sessions, conversions, bySource, topLandingPages };
}

export { getSummary, getSummaryForRange, getTopLandingPages, getOrganicLandingPages, getAiReferrals };

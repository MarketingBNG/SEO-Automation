import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';

// The key can be the JSON itself in GOOGLE_SERVICE_ACCOUNT_KEY_JSON (hosted deployments have no
// local files) or a path to the key file in GOOGLE_SERVICE_ACCOUNT_KEY_PATH (local).
function googleAuth(scopes) {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON), scopes });
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env');
  }
  const resolvedPath = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service account key file not found at ${resolvedPath}`);
  }
  return new google.auth.GoogleAuth({ keyFile: resolvedPath, scopes });
}

function getAuth() {
  return googleAuth(['https://www.googleapis.com/auth/webmasters.readonly']);
}

// Lists every Search Console property this service account can see. Good connection test:
// it doesn't need to guess the exact property format, and an empty list means the service
// account email hasn't been added as a user in Search Console yet.
async function listAccessibleSites() {
  const auth = getAuth();
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const res = await searchconsole.sites.list();
  return res.data.siteEntry || [];
}

function getSiteUrl() {
  const siteUrl = process.env.GSC_SITE_URL;
  if (!siteUrl) throw new Error('GSC_SITE_URL is not set in .env');
  return siteUrl;
}

// Top queries/pages for the last N days - the core "what are people finding us for" signal
// that feeds the Opportunity Engine later.
async function getTopQueries({ days = 28, rowLimit = 25 }: any = {}) {
  const auth = getAuth();
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const siteUrl = getSiteUrl();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query'],
      rowLimit,
    },
  });

  return res.data.rows || [];
}

// Flexible Search Analytics query: any dimensions, explicit date range, optional filters
// (e.g. [{ dimension: 'query', operator: 'contains', expression: 'fbar' }]).
async function querySearchAnalytics({ startDate, endDate, dimensions = ['query'], rowLimit = 25, filters = [] }: any) {
  const auth = getAuth();
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const res = await searchconsole.searchanalytics.query({
    siteUrl: getSiteUrl(),
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    },
  });
  return res.data.rows || [];
}

// Date strings for "the last N days" and "the N days before that", ending 2 days ago because
// Search Console data for the most recent ~48 hours is incomplete.
function comparisonRanges(days = 28) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    current: { startDate: fmt(start), endDate: fmt(end) },
    previous: { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
  };
}

export { listAccessibleSites, getTopQueries, getSiteUrl, querySearchAnalytics, comparisonRanges, googleAuth };

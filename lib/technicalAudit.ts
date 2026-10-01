// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as XLSX from 'xlsx';

// Parses a Screaming Frog CSV export (works with the standard "Internal All" export, and is
// tolerant of other Screaming Frog report exports - it just uses whichever of these columns
// are actually present). Column names match Screaming Frog's default export headers.
// Takes the uploaded file's bytes. (XLSX.readFile cannot reach the filesystem in the ESM build,
// which made every upload fail with "Cannot access file /tmp/...".)
function parseScreamingFrogCsv(data: Buffer | Uint8Array) {
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) {
    throw new Error('The CSV file appears to be empty.');
  }

  // Screaming Frog column names vary slightly by version/report; find them case-insensitively.
  const keys = Object.keys(rows[0]);
  const findKey = (patterns) => keys.find((k) => patterns.some((p) => new RegExp(p, 'i').test(k)));

  const addressKey = findKey(['^address$', '^url$']);
  const statusCodeKey = findKey(['^status code$']);
  const titleKey = findKey(['^title 1$', '^title$']);
  const metaDescKey = findKey(['^meta description 1$', '^meta description$']);
  const wordCountKey = findKey(['^word count$']);

  const titleCounts: any = {};
  const problems: any[] = [];
  let brokenCount = 0;
  let missingTitleCount = 0;
  let missingMetaCount = 0;
  let thinContentCount = 0;

  for (const row of rows) {
    const url = addressKey ? String(row[addressKey] || '').trim() : '';
    const issues: any[] = [];

    const statusCode = statusCodeKey ? parseInt(row[statusCodeKey], 10) : null;
    if (statusCode && statusCode >= 400) {
      brokenCount++;
      issues.push(`${statusCode} status code`);
    }

    const title = titleKey ? String(row[titleKey] || '').trim() : '';
    if (titleKey) {
      if (!title) {
        missingTitleCount++;
        issues.push('Missing title');
      } else {
        titleCounts[title] = (titleCounts[title] || 0) + 1;
      }
    }

    const metaDesc = metaDescKey ? String(row[metaDescKey] || '').trim() : '';
    if (metaDescKey && !metaDesc) {
      missingMetaCount++;
      issues.push('Missing meta description');
    }

    const wordCount = wordCountKey ? parseInt(row[wordCountKey], 10) : null;
    if (wordCount !== null && !isNaN(wordCount) && wordCount > 0 && wordCount < 300) {
      thinContentCount++;
      issues.push(`Thin content (${wordCount} words)`);
    }

    if (issues.length && url) {
      problems.push({ url, issues });
    }
  }

  const duplicateTitleCount = Object.values(titleCounts).filter((c) => c > 1).length;
  // Mark duplicate-title rows too, capped list stays readable.
  for (const row of rows) {
    const url = addressKey ? String(row[addressKey] || '').trim() : '';
    const title = titleKey ? String(row[titleKey] || '').trim() : '';
    if (title && titleCounts[title] > 1) {
      const existing = problems.find((p) => p.url === url);
      if (existing) existing.issues.push('Duplicate title');
      else if (url) problems.push({ url, issues: ['Duplicate title'] });
    }
  }

  return {
    totalUrls: rows.length,
    brokenCount,
    missingTitleCount,
    duplicateTitleCount,
    missingMetaCount,
    thinContentCount,
    problemUrls: problems.slice(0, 200), // cap for storage/display
    columnsFound: { addressKey, statusCodeKey, titleKey, metaDescKey, wordCountKey },
  };
}

export { parseScreamingFrogCsv };

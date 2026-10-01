function getToken() {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) throw new Error('CLARITY_API_TOKEN is not set in .env');
  return token;
}

// Clarity's Data Export API only allows numOfDays 1, 2, or 3, and up to 3 breakdown
// dimensions (e.g. "Browser", "Device", "URL"). No dimensions = one overall summary row set.
async function getInsights({ numOfDays = 3, dimensions = [] }: any = {}) {
  const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights');
  url.searchParams.set('numOfDays', String(numOfDays));
  dimensions.slice(0, 3).forEach((d, i) => url.searchParams.set(`dimension${i + 1}`, d));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clarity API error (${res.status}): ${body}`);
  }

  return res.json();
}

export { getInsights };

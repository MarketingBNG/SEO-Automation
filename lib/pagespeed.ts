function getApiKey() {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) throw new Error('PAGESPEED_API_KEY is not set in .env');
  return key;
}

// Runs a PageSpeed Insights check for one URL. strategy: 'mobile' | 'desktop'.
async function runPageSpeedCheck(url, strategy = 'mobile') {
  const endpoint = new URL('https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.set('key', getApiKey());
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) =>
    endpoint.searchParams.append('category', c)
  );

  const res = await fetch(endpoint.toString());
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`PageSpeed API error: ${json.error?.message || res.status}`);
  }

  const categories = json.lighthouseResult?.categories || {};
  const audits = json.lighthouseResult?.audits || {};
  const crux = json.loadingExperience?.metrics || null;

  return {
    url,
    strategy,
    scores: {
      performance: categories.performance ? Math.round(categories.performance.score * 100) : null,
      accessibility: categories.accessibility ? Math.round(categories.accessibility.score * 100) : null,
      bestPractices: categories['best-practices'] ? Math.round(categories['best-practices'].score * 100) : null,
      seo: categories.seo ? Math.round(categories.seo.score * 100) : null,
    },
    labMetrics: {
      lcp: audits['largest-contentful-paint']?.displayValue || null,
      cls: audits['cumulative-layout-shift']?.displayValue || null,
      tbt: audits['total-blocking-time']?.displayValue || null,
    },
    // CrUX field data (real user data), only present if the URL has enough traffic
    fieldData: crux
      ? {
          lcp: crux.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
          cls: crux.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile,
          inp: crux.INTERACTION_TO_NEXT_PAINT?.percentile,
          overallCategory: json.loadingExperience?.overall_category,
        }
      : null,
  };
}

export { runPageSpeedCheck };

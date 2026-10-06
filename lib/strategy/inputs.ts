// @ts-nocheck -- matches the untyped style of the integration modules it reads from.
// Collects the real numbers a strategy is built from. Every number carries its source and date
// range; anything a tool could not return becomes "DATA MISSING: <metric>" instead of a guess.
// Analytics and the month-end report are read, never rebuilt.
import prisma from '../prisma';
import { cachedPerformance } from '../performanceReport';
import { gatherSnapshot } from '../seoStrategy';
import { listSites, getSiteRankings, researchKeywords, getReferringDomainsCount, getBacklinkGap } from '../seranking';
import { liveSearch } from '../serphouse';
import { getLeadSourceBreakdown } from '../zoho';
import { hasStoredTokens } from '../zohoAuth';
import * as settings from '../settings';
import { metric, keywordKey, CRAWL_MAX_AGE_DAYS } from './core';

const SITE_HOST = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

const kpiOf = (block, label) => (block?.kpis || []).find((k) => k.label === label) || null;

// SERP features we hold for the priority keywords, from live SERPHouse checks (US and India).
export async function serpFeatureCounts(keywords: string[]) {
  const host = SITE_HOST();
  const rows: any[] = [];
  for (const q of keywords) {
    for (const loc of ['United States', 'India']) {
      try {
        const json = await liveSearch({ q, loc, timeoutMs: 120000 });
        const r = json.results?.results || {};
        const fs = r.featured_snippet || r.answer_box || r.featured_snippets?.[0] || null;
        const fsLink = String(fs?.link || fs?.url || '');
        const paa = r.people_also_ask || [];
        const aio = r.ai_overview;
        rows.push({
          keyword: q,
          market: loc,
          featuredSnippetOurs: fsLink.includes(host),
          paaOurs: paa.filter((p) => String(p.link || p.url || '').includes(host)).length,
          aiOverviewCitesUs: Boolean((aio?.references || []).some((x) => String(x.link || '').includes(host))),
          hasAiOverview: Boolean(aio?.contents?.length),
        });
      } catch (e: any) {
        rows.push({ keyword: q, market: loc, error: e.message });
      }
    }
  }
  const ok = rows.filter((r) => !r.error);
  return {
    checked: ok.length,
    failed: rows.length - ok.length,
    featuredSnippets: ok.length ? ok.filter((r) => r.featuredSnippetOurs).length : null,
    paaAppearances: ok.length ? ok.reduce((s, r) => s + r.paaOurs, 0) : null,
    aiOverviewCitations: ok.length ? ok.filter((r) => r.aiOverviewCitesUs).length : null,
    rows,
  };
}

// Keyword data from SE Ranking for one keyword in the US and India databases.
export async function keywordData(keyword: string) {
  const pick = async (source) => {
    try {
      const list = await researchKeywords('similar', keyword, { source, limit: 50 });
      return list.find((k) => keywordKey(k.keyword) === keywordKey(keyword)) || null;
    } catch {
      return null;
    }
  };
  const [us, india] = [await pick('us'), await pick('in')];
  return {
    volumeUs: us?.volume ?? null,
    volumeIndia: india?.volume ?? null,
    difficulty: us?.difficulty ?? india?.difficulty ?? null,
  };
}

export async function gatherStrategyInputs({ onStep }: any = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const out: any = { gatheredAt: today, missing: [] as string[] };

  // Month-end report (already built in the Performance section); read only.
  onStep?.('Reading last month\'s report', 0.05);
  let perf: any = null;
  try {
    perf = await cachedPerformance(28);
  } catch (e: any) {
    out.missing.push(`month-end report (${e.message})`);
  }
  const range = perf ? `${perf.ranges.current.startDate} to ${perf.ranges.current.endDate}` : 'n/a';
  const prevRange = perf ? `${perf.ranges.previous.startDate} to ${perf.ranges.previous.endDate}` : 'n/a';
  out.reportRange = range;

  const fromKpi = (block, label, name, source) => {
    const k = kpiOf(perf?.[block], label);
    return { now: metric(k?.now, source, range, name), before: metric(k?.before, source, prevRange, name), changePct: k?.changePct ?? null };
  };
  const seoClicks = fromKpi('seo', 'Google clicks', 'Google clicks', 'Google Search Console');
  const seoImpr = fromKpi('seo', 'Impressions', 'Google impressions', 'Google Search Console');
  const aeoQ = fromKpi('aeo', 'Clicks from question searches', 'question-search clicks', 'Google Search Console');
  const geoAi = fromKpi('geo', 'Visits from AI assistants', 'AI assistant visits', 'GA4');
  out.trendSources = {
    SEO: 'Google clicks change in the month-end report',
    AEO: 'Question-search clicks change in the month-end report',
    GEO: 'AI assistant visits change in the month-end report',
  };
  out.lastMonthTrend = { SEO: seoClicks.changePct, AEO: aeoQ.changePct, GEO: geoAi.changePct };

  // SE Ranking: tracked keywords and positions.
  onStep?.('Reading SE Ranking positions', 0.15);
  let rankings: any[] = [];
  let rankDate = today;
  try {
    const sites = await listSites();
    if (sites.length) {
      rankings = await getSiteRankings(sites[0].id);
      rankDate = rankings.find((r) => r.date)?.date || today;
    }
  } catch (e: any) {
    out.missing.push(`SE Ranking positions (${e.message})`);
  }
  out.rankings = rankings.slice(0, 300);
  const ranked = rankings.filter((r) => r.position > 0);
  const top3 = rankings.length ? ranked.filter((r) => r.position <= 3).length : null;
  const top10 = rankings.length ? ranked.filter((r) => r.position <= 10).length : null;

  // SE Ranking: referring domains and backlink gap vs competitors.
  onStep?.('Reading SE Ranking backlinks', 0.25);
  let refDomains = null;
  try {
    refDomains = await getReferringDomainsCount(SITE_HOST());
  } catch (e: any) {
    out.missing.push(`referring domains (${e.message})`);
  }
  const competitors = String((await settings.get('competitor_domains')) || '')
    .split(/[\s,]+/)
    .filter(Boolean);
  out.competitors = competitors;
  out.backlinkGap = [];
  if (competitors.length) {
    try {
      out.backlinkGap = await getBacklinkGap(SITE_HOST(), competitors, 40);
    } catch (e: any) {
      out.missing.push(`backlink gap (${e.message})`);
    }
  } else {
    out.missing.push('backlink gap (no competitor domains in Settings, key "competitor_domains")');
  }

  // Live SERP features for the top priority keywords (AEO: snippets, PAA, AI Overviews).
  onStep?.('Checking featured snippets, People Also Ask and AI Overviews', 0.35);
  const priority = rankings
    .filter((r) => r.position > 0 && r.position <= 30)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 15)
    .map((r) => r.keyword);
  const serp = priority.length ? await serpFeatureCounts(priority) : null;
  out.serpFeatures = serp;
  const serpRange = `live SERP check on ${today}, ${serp?.checked || 0} keyword-market pairs`;

  // Zoho organic leads: signal only.
  let leads = null;
  try {
    if (await hasStoredTokens()) {
      const z = await getLeadSourceBreakdown();
      leads = z.bySource.filter((s) => /organic|seo|google|website|blog|search/i.test(s.source)).reduce((s, r) => s + r.total, 0);
    }
  } catch (e: any) {
    out.missing.push(`Zoho leads (${e.message})`);
  }

  out.lastMonth = {
    SEO: {
      clicks: seoClicks.now,
      impressions: seoImpr.now,
      top3: metric(top3, 'SE Ranking', `positions on ${rankDate}`, 'top 3 keywords'),
      top10: metric(top10, 'SE Ranking', `positions on ${rankDate}`, 'top 10 keywords'),
      referringDomains: metric(refDomains, 'SE Ranking backlinks', `as of ${today}`, 'referring domains'),
    },
    AEO: {
      featuredSnippets: metric(serp?.featuredSnippets, 'SERPHouse', serpRange, 'featured snippets'),
      paa: metric(serp?.paaAppearances, 'SERPHouse', serpRange, 'PAA appearances'),
      aiOverview: metric(serp?.aiOverviewCitations, 'SERPHouse', serpRange, 'AI Overview citations'),
    },
    // No connected tool counts unclicked mentions inside ChatGPT, Perplexity or Gemini answers.
    GEO: { aiMentions: metric(null, 'No connected source', range, 'AI chat mentions'), aiVisits: geoAi.now },
    Signal: { organicLeads: metric(leads, 'Zoho CRM', 'all leads returned by Zoho (up to 1000)', 'organic leads') },
  };

  // Latest Screaming Frog crawl (Section 8).
  const crawl = await prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });
  out.crawl = crawl
    ? {
        id: crawl.id,
        uploadedAt: crawl.created_at,
        uploadedBy: crawl.uploaded_by,
        totalUrls: crawl.total_urls,
        broken: crawl.broken_count,
        missingTitle: crawl.missing_title_count,
        duplicateTitle: crawl.duplicate_title_count,
        missingMeta: crawl.missing_meta_count,
        thin: crawl.thin_content_count,
        problems: JSON.parse(crawl.problem_urls || '[]').slice(0, 60),
        linkIssues: JSON.parse(crawl.link_issues || '[]').slice(0, 60),
        maxAgeDays: CRAWL_MAX_AGE_DAYS,
      }
    : null;
  if (!crawl) out.missing.push('Screaming Frog crawl (none uploaded)');

  // The deeper analysis (striking distance, decay, cannibalization, AI visibility) from Search
  // Console, GA4, SERPHouse, WordPress, PageSpeed and Clarity.
  onStep?.('Running the full site analysis', 0.45);
  try {
    out.snapshot = await gatherSnapshot({ onStep: (l, f) => onStep?.(l, 0.45 + 0.4 * f) });
  } catch (e: any) {
    out.missing.push(`site analysis (${e.message})`);
  }

  out.usedKeywords = (await prisma.strategy_keywords.findMany({ select: { keyword: true, period: true } })).map((k) => `${k.keyword} (${k.period})`);
  out.focusServices = String((await settings.get('focus_services')) || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  out.reportErrors = perf?.errors || {};
  return out;
}

import prisma from './prisma';
import { gatherStrategyAnalysis } from './strategyAnalysis';
import { gatherMonthlyMetrics } from './monthlyMetrics';
import { getSiteRankings, listSites } from './seranking';
import { getTopQueries } from './searchConsole';
import { getSummary, getTopLandingPages } from './ga4';
import { runPageSpeedCheck } from './pagespeed';
import { getInsights } from './clarity';
import { getLeadSourceBreakdown } from './zoho';
import { hasStoredTokens } from './zohoAuth';
// Pulls a snapshot from every currently-connected tool for the monthly SEO strategy. Each
// source fails independently (a not-yet-connected or temporarily-down tool just gets skipped
// with a note) so one missing integration never blocks the whole report. New tools added later
// (Ahrefs, Zoho, etc.) plug in here the same way.
async function gatherSnapshot({ onStep }: any = {}) {
  const snapshot: any = {};

  await Promise.allSettled([
    (async () => {
      snapshot.analysis = await gatherStrategyAnalysis({ onStep });
    })().catch((e: any) => {
      snapshot.analysisError = e.message;
    }),

    (async () => {
      snapshot.monthOverMonth = await gatherMonthlyMetrics(28);
    })().catch((e: any) => {
      snapshot.monthOverMonthError = e.message;
    }),

    (async () => {
      const sites = await listSites();
      if (sites.length) {
        snapshot.rankings = await getSiteRankings(sites[0].id);
      }
    })().catch((e: any) => {
      snapshot.rankingsError = e.message;
    }),

    (async () => {
      snapshot.searchConsoleTopQueries = await getTopQueries({ days: 28, rowLimit: 20 });
    })().catch((e: any) => {
      snapshot.searchConsoleError = e.message;
    }),

    (async () => {
      snapshot.ga4Summary = await getSummary(28);
      snapshot.ga4TopPages = await getTopLandingPages(28, 15);
    })().catch((e: any) => {
      snapshot.ga4Error = e.message;
    }),

    (async () => {
      const siteUrl = (process.env.WORDPRESS_SITE_URL || '').replace(/\/+$/, '') + '/';
      snapshot.pageSpeed = await runPageSpeedCheck(siteUrl, 'mobile');
    })().catch((e: any) => {
      snapshot.pageSpeedError = e.message;
    }),

    (async () => {
      const raw = await getInsights({ numOfDays: 3 });
      const byName: any = {};
      for (const m of raw) byName[m.metricName] = m.information?.[0] || {};
      snapshot.clarity = byName;
    })().catch((e: any) => {
      snapshot.clarityError = e.message;
    }),

    (async () => {
      const latest = await prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });
      if (latest) {
        snapshot.technicalCrawl = {
          importedAt: latest.created_at,
          totalUrls: latest.total_urls,
          brokenCount: latest.broken_count,
          missingTitleCount: latest.missing_title_count,
          duplicateTitleCount: latest.duplicate_title_count,
          missingMetaCount: latest.missing_meta_count,
          thinContentCount: latest.thin_content_count,
        };
      }
    })().catch((e: any) => {
      snapshot.technicalCrawlError = e.message;
    }),

    (async () => {
      if (await hasStoredTokens()) {
        snapshot.zohoLeads = await getLeadSourceBreakdown();
      }
    })().catch((e: any) => {
      snapshot.zohoError = e.message;
    }),
  ]);

  return snapshot;
}

export { gatherSnapshot };

// @ts-nocheck -- reads untyped plan JSON and SE Ranking rows.
// "Update with latest changes": brings an existing strategy up to date with what the dashboard can
// now do, WITHOUT rebuilding it (no deep research, so it costs cents, not dollars):
//  - Section 7 (automation) and 10 (safeguards) are replaced with the current lists,
//  - Section 6 gets backlink targets from the SE Ranking gap for the current competitor list
//    (only sites not already planned); one small Claude call picks our page for each,
//  - Section 8 is rebuilt from the latest Screaming Frog crawl if a newer one was uploaded,
//    keeping every fix you unticked.
// When the strategy is approved, new backlink tasks and newly ticked fixes are queued at once.
// Everything else (keywords, blog calendar, targets, summary) is left exactly as it is.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { callClaude } from '../anthropic';
import { getBacklinkGap } from '../seranking';
import { competitorList, detectCompetitors, searchCompetitorsFromSerp } from '../competitors';
import { SAFEGUARDS } from './core';
import { AUTOMATION, technicalFixesFromCrawl, calendarSlots, parseJson } from './generate';
import { fixKind } from './fixer';
import { strategyView, latestCrawl, trackStrategyKeywords } from './service';

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');
const HOST = () => SITE().replace(/^https?:\/\//, '').replace(/^www\./, '');
const dom = (s: string) => String(s || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

// Picks our best page for each new backlink target (no web search; a few cents).
async function assignPages(sites: string[], plan: any) {
  const pages = [
    ...(plan.blogPlan?.calendar || []).map((b) => `${b.title} (keyword: ${b.mainKeyword}${b.refreshUrl ? `, ${b.refreshUrl}` : ''})`),
    ...(plan.technical?.refreshes || []).map((r) => r.page),
  ].slice(0, 60);
  const { text } = await callClaude(
    `For each site, pick the page of ${SITE()} that best fits a link from that site, and the safest method: "Outreach to SE Ranking backlink gap site", "Unlinked brand mention" or "Broken link replacement". Use a full URL on ${HOST()} or a path like /blog-slug. If nothing fits, use the home page "/".
Return ONLY ===JSON===[{"targetSite":"","ourPage":"","method":"","tags":["SEO"]}]===END===`,
    [{ role: 'user', content: `Sites:\n${sites.join('\n')}\n\nOur pages and planned blogs:\n${pages.join('\n')}` }],
    undefined,
    { maxUses: 1, effort: 'low', feature: 'strategy-refresh' }
  );
  const rows = parseJson(text);
  return Array.isArray(rows) ? rows : [];
}

export async function refreshStrategy(id: number, actor: string, { pick = assignPages, gap = getBacklinkGap, serpCheck = searchCompetitorsFromSerp, detect = detectCompetitors }: any = {}) {
  const row = await prisma.seo_strategies.findUnique({ where: { id } });
  if (!row?.plan_json) throw Object.assign(new Error('Not found'), { status: 404 });
  if (row.status === 'generating') throw Object.assign(new Error('The strategy is still being generated.'), { status: 409 });
  const lastUsage = await prisma.ai_usage.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  const plan = JSON.parse(row.plan_json);
  const changes: string[] = [];
  const notes: string[] = [];

  // Sections 7 and 10: current automation and safeguards.
  if (JSON.stringify(plan.automation) !== JSON.stringify(AUTOMATION)) {
    const before = new Set((plan.automation || []).map((a) => a.what));
    const added = AUTOMATION.filter((a) => !before.has(a.what)).length;
    plan.automation = AUTOMATION;
    changes.push(`Section 7: ${added} new automation step(s) added`);
  }
  if (JSON.stringify(plan.safeguards) !== JSON.stringify(SAFEGUARDS)) {
    plan.safeguards = SAFEGUARDS;
    changes.push('Section 10: safeguards updated');
  }

  // Section 6: new targets from the backlink gap.
  // Competitor list: use the one that exists; if there is none, build it now from Google results
  // for this strategy's main keywords (SERPHouse searches plus one small Claude check).
  let comp = await competitorList();
  if (comp.domains.length) {
    notes.push(`Competitor list found (${comp.source}): ${comp.domains.join(', ')}`);
  } else {
    const kws = [...(plan.keywords || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).map((k) => k.keyword || k.mainKeyword).filter(Boolean);
    const fromCalendar = (plan.blogPlan?.calendar || []).map((b) => b.mainKeyword).filter(Boolean);
    const keywords = [...new Set([...kws, ...fromCalendar])];
    if (keywords.length) {
      try {
        const serp = await serpCheck(keywords, HOST());
        const found = serp.length ? await detect(serp, HOST()) : [];
        if (found.length) {
          comp = { domains: found, source: 'built now from Google results for this strategy keywords' };
          notes.push(`Competitor list was missing, so it was built now and saved: ${found.join(', ')}`);
        }
      } catch (e: any) {
        notes.push(`Could not build the competitor list: ${e.message}`);
      }
    }
  }
  if (!comp.domains.length) {
    notes.push('No competitor list yet and none could be built (Google results were not available). Backlink targets were not changed.');
  } else {
    let gapRows = [];
    try {
      gapRows = await gap(HOST(), comp.domains, 40);
    } catch (e: any) {
      notes.push(`SE Ranking backlink gap failed: ${e.message}`);
    }
    const have = new Set((plan.backlinks || []).map((b) => dom(b.targetSite)));
    const fresh = [...new Set(gapRows.map((g) => dom(g.domain || g.refdomain || g.targetSite || g)).filter((d) => d && !have.has(d)))].slice(0, 20);
    if (fresh.length) {
      const picked = await pick(fresh, plan);
      const today = new Date();
      const slots = calendarSlots(plan.startDate ? { start: plan.startDate, end: plan.endDate } : plan, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '11:00', 40, today).map((x) => x.slice(0, 10));
      const added = [];
      for (const [i, site] of fresh.entries()) {
        const p = picked.find((x) => dom(x.targetSite) === site) || {};
        added.push({
          targetSite: site,
          method: p.method || 'Outreach to SE Ranking backlink gap site',
          ourPage: p.ourPage || '/',
          sendDate: slots[i % Math.max(1, slots.length)] || today.toISOString().slice(0, 10),
          status: 'planned',
          tags: Array.isArray(p.tags) && p.tags.length ? p.tags : ['SEO'],
        });
      }
      plan.backlinks = [...(plan.backlinks || []), ...added];
      changes.push(`Section 6: ${added.length} new backlink target(s) from the SE Ranking gap (competitors ${comp.source})`);
    } else if (gapRows.length) {
      notes.push('Backlink gap checked: no new sites beyond the ones already planned.');
    }
  }

  // Section 8: rebuild from a newer crawl, keeping unticked fixes unticked.
  const crawl = await latestCrawl();
  if (crawl && crawl.created_at !== plan.technical?.crawl?.uploadedAt) {
    const off = new Set((plan.technical?.fixes || []).filter((f) => f.apply === false).map((f) => `${f.url}|${f.issue}`));
    const parsed = { problems: JSON.parse(crawl.problem_urls || '[]'), linkIssues: JSON.parse(crawl.link_issues || '[]') };
    const aiFixes = (plan.technical?.fixes || []).filter((f) => f.fromAi);
    const fixes = [...technicalFixesFromCrawl(parsed), ...aiFixes].map((f) => (off.has(`${f.url}|${f.issue}`) ? { ...f, apply: false } : f));
    plan.technical = { ...plan.technical, crawl: { uploadedAt: crawl.created_at, uploadedBy: crawl.uploaded_by, totalUrls: crawl.total_urls }, fixes };
    changes.push(`Section 8: rebuilt from the crawl uploaded ${crawl.created_at} (${fixes.length} fixes)`);
  }

  const cost = lastUsage
    ? (await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: { id: { gt: lastUsage.id }, feature: 'strategy-refresh' } }))._sum.cost_usd || 0
    : (await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: { feature: 'strategy-refresh' } }))._sum.cost_usd || 0;

  // SE Ranking tracking is brought up to date on every refresh (no credits).
  if (row.status === 'approved') trackStrategyKeywords(id);
  if (!changes.length) {
    return { view: await strategyView(row), changes, notes: notes.length ? notes : ['Already up to date. Nothing changed.'], cost };
  }

  const approved = row.status === 'approved';
  const version = (row.version || 1) + 1;
  await prisma.$transaction(async (tx) => {
    await tx.seo_strategies.update({ where: { id }, data: { plan_json: JSON.stringify(plan), version } });
    await tx.strategy_edits.create({ data: { strategy_id: id, reviewer: actor, section: 'update', old_value: JSON.stringify(null), new_value: JSON.stringify(changes), version } });
    if (approved) {
      await tx.strategy_changes.create({ data: { strategy_id: id, what: `Updated with latest changes (version ${version}): ${changes.join('; ')}`, why: 'New dashboard features or new data', approved_by: actor } });
      // New backlink targets become tasks; existing tasks are never touched.
      const existing = new Set((await tx.backlink_tasks.findMany({ where: { strategy_id: id } })).map((t) => dom(t.target_site)));
      for (const l of plan.backlinks || []) {
        if (existing.has(dom(l.targetSite))) continue;
        await tx.backlink_tasks.create({ data: { strategy_id: id, target_site: l.targetSite, method: l.method, our_page: l.ourPage || '', send_date: l.sendDate || '', tags: JSON.stringify(l.tags || []) } });
      }
      // Ticked fixes not queued yet are queued.
      const queued = new Set((await tx.technical_fix_tasks.findMany({ where: { strategy_id: id } })).map((t) => `${t.url}|${t.issue}`));
      for (const f of plan.technical?.fixes || []) {
        if (f.apply === false || !f.url || !f.issue || queued.has(`${f.url}|${f.issue}`)) continue;
        await tx.technical_fix_tasks.create({ data: { strategy_id: id, url: f.url, issue: f.issue, fix: f.fix || '', kind: fixKind(f.issue) } });
      }
    }
  });
  await activity.log('strategy.updated', { entityType: 'seo_strategy', entityId: id, details: `${changes.join('; ')}. AI cost $${cost.toFixed(2)}`, actor });
  return { view: await strategyView(await prisma.seo_strategies.findUnique({ where: { id } })), changes, notes, cost, at: sqlNow() };
}

// @ts-nocheck -- reads untyped plan JSON.
// How far an approved strategy has got (blogs published, backlink tasks done, days used) and what
// the month will cost in AI credits. The cost uses this account's real averages from ai_usage when
// there is history, otherwise clearly labelled default assumptions.
import prisma from '../prisma';

// Default per-unit estimates (USD, Claude Opus 5.5 at max effort with web search) used until the
// dashboard has measured real averages.
const DEFAULTS = { strategy: 8, blogDraft: 3, factCheckPerBlog: 4, otherPerDay: 0.5, outreachLead: 0.15, technicalFix: 0.05, update: 0.1 };

async function avgCost(features: string[], perUnitRows: number) {
  const ago = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const r = await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: { feature: { in: features }, created_at: { gte: ago } } });
  const total = r._sum.cost_usd || 0;
  return perUnitRows > 0 && total > 0 ? total / perUnitRows : null;
}

export async function strategyProgress(strategyId: number) {
  const s = await prisma.seo_strategies.findUnique({ where: { id: strategyId } });
  if (!s?.plan_json) return null;
  const plan = JSON.parse(s.plan_json);
  const blogsPlanned = plan.blogPlan?.calendar?.length || 0;

  // Execution (approved strategies only).
  const rows = s.status === 'approved' ? await prisma.blog_schedule.findMany({ where: { strategy_id: strategyId } }) : [];
  const count = (st) => rows.filter((r) => r.status === st).length;
  const blogs = {
    total: rows.length || blogsPlanned,
    published: count('published'),
    inReview: count('in_review'),
    held: count('held'),
    drafting: count('drafting'),
    planned: count('planned'),
  };
  const links = s.status === 'approved' ? await prisma.backlink_tasks.findMany({ where: { strategy_id: strategyId }, orderBy: { send_date: 'asc' } }) : [];
  const backlinks = { total: links.length || (plan.backlinks?.length || 0), done: links.filter((l) => l.status === 'done').length, tasks: links };
  // Technical fixes queued on approval: applied, needing a person, failed, still waiting.
  const fixRows = s.status === 'approved' ? await prisma.technical_fix_tasks.findMany({ where: { strategy_id: strategyId }, select: { status: true, applied_at: true } }) : [];
  const fixCount = (st) => fixRows.filter((f) => f.status === st).length;
  const lastFix = fixRows.map((f) => f.applied_at).filter(Boolean).sort().pop() || null;
  const fixes = { total: fixRows.length, applied: fixCount('applied'), manual: fixCount('manual'), failed: fixCount('failed'), planned: fixCount('planned'), lastRun: lastFix };
  const units = blogs.total + backlinks.total;
  const percent = units ? Math.round(((blogs.published + backlinks.done) / units) * 100) : 0;
  const start = plan.startDate ? Date.parse(`${plan.startDate}T00:00:00Z`) : null;
  const daysUsed = start ? Math.min(30, Math.max(0, Math.floor((Date.now() - start) / 86400000) + 1)) : null;

  // AI cost: measured averages when available.
  const draftsWritten = await prisma.drafts.count({ where: { created_at: { gte: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ') } } });
  const strategiesRun = await prisma.seo_strategies.count({ where: { plan_json: { not: null }, created_at: { gte: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ') } } });
  const perBlog = await avgCost(['blog'], draftsWritten);
  const perFact = await avgCost(['fact-check'], draftsWritten);
  const perStrategy = await avgCost(['strategy'], strategiesRun);
  const otherDaily = (await avgCost(['reports', 'meetings', 'assistant', 'audit', 'training', 'other'], 60)) ?? null;
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const leadsPushed = await prisma.backlink_tasks.count({ where: { sent_at: { gte: since60 } } });
  const fixesRun = await prisma.technical_fix_tasks.count({ where: { applied_at: { gte: since60 }, status: 'applied' } });
  const perLead = await avgCost(['outreach'], leadsPushed);
  const perFix = await avgCost(['technical_fix'], fixesRun);
  const emailTasks = (links.length ? links : plan.backlinks || []).filter((l) => !/internal|directory|citation/i.test(l.method || '')).length;
  const fixesPlanned = s.status === 'approved'
    ? await prisma.technical_fix_tasks.count({ where: { strategy_id: strategyId, kind: { in: ['title', 'meta', 'thin'] } } })
    : (plan.technical?.fixes || []).filter((f) => f.apply !== false && /title|meta description|thin content/i.test(f.issue || '')).length;
  const lines = [
    { item: 'Strategy research (this strategy)', units: 1, unitCost: perStrategy ?? DEFAULTS.strategy, measured: perStrategy !== null },
    { item: 'Blog writing', units: blogs.total, unitCost: perBlog ?? DEFAULTS.blogDraft, measured: perBlog !== null },
    { item: 'Fact checking (check, correct, re-check)', units: blogs.total, unitCost: perFact ?? DEFAULTS.factCheckPerBlog, measured: perFact !== null },
    { item: 'Backlink outreach (opening line per Smartlead lead)', units: emailTasks, unitCost: perLead ?? DEFAULTS.outreachLead, measured: perLead !== null },
    { item: 'Technical fixes written by Claude (titles, meta, FAQs)', units: fixesPlanned, unitCost: perFix ?? DEFAULTS.technicalFix, measured: perFix !== null },
    { item: 'Competitor check and strategy updates', units: 2, unitCost: DEFAULTS.update, measured: false },
    { item: 'Reports, meetings, Assistant and other (30 days)', units: 30, unitCost: otherDaily ?? DEFAULTS.otherPerDay, measured: otherDaily !== null },
  ].map((l) => ({ ...l, cost: l.units * l.unitCost }));
  const estimate = lines.reduce((t, l) => t + l.cost, 0);
  const spentSinceApproval = s.approved_at
    ? (await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: { created_at: { gte: s.approved_at } } }))._sum.cost_usd || 0
    : 0;

  return {
    status: s.status,
    window: { start: plan.startDate || null, end: plan.endDate || null, daysUsed },
    blogs,
    backlinks,
    fixes,
    percent,
    cost: { estimate, lines, spentSinceApproval, basis: lines.every((l) => l.measured) ? 'measured' : lines.some((l) => l.measured) ? 'mixed' : 'default' },
  };
}

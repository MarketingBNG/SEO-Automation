// AI credit tracking and the automatic pause.
//
// Anthropic's API does not report the account's remaining credit balance (only an Admin API key can
// read cost reports), so the dashboard counts the cost of every Claude call itself from the token
// usage each response returns, priced at Anthropic's published per-token rates. You enter your
// balance after each top-up; remaining = that balance minus everything spent since.
//
// When the estimated remaining balance drops below the pause threshold (default $5), or Anthropic
// answers "credit balance is too low", all AI work pauses: new Claude calls are refused with a clear
// message and a generating strategy is paused, until you update the balance (or resume) in Settings.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';

// USD per 1M tokens (Anthropic first-party API). Cache writes are 1.25x input (5-minute cache).
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};
const WEB_SEARCH_PER_1000 = 10;

export class CreditPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditPausedError';
  }
}

export function priceFor(model: string) {
  return PRICES[model] || PRICES['claude-opus-5-5'];
}

// Cost in USD of one response's usage. Batch requests are billed at half price.
export function costOf(model: string, usage: any, { batch = false } = {}) {
  if (!usage) return 0;
  const p = priceFor(model);
  const searches = usage.server_tool_use?.web_search_requests || 0;
  const tokens =
    ((usage.input_tokens || 0) * p.input +
      (usage.output_tokens || 0) * p.output +
      (usage.cache_read_input_tokens || 0) * p.cacheRead +
      (usage.cache_creation_input_tokens || 0) * p.input * 1.25) /
    1e6;
  return (batch ? tokens / 2 : tokens) + (searches * WEB_SEARCH_PER_1000) / 1000;
}

export async function recordUsage({ model, usage, feature = 'other', batch = false }: { model: string; usage: any; feature?: string; batch?: boolean }) {
  if (!usage) return 0;
  const cost = costOf(model, usage, { batch });
  await prisma.ai_usage
    .create({
      data: {
        feature,
        model,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        web_searches: usage.server_tool_use?.web_search_requests || 0,
        cost_usd: cost,
      },
    })
    .catch((e) => console.error('Could not record AI usage:', e.message));
  // Pause as soon as the estimate crosses the threshold, not only at the next call.
  await checkThreshold().catch(() => {});
  return cost;
}

const num = (v: any, d: number | null = null) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

async function spentSince(since: string | null) {
  const r = await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: since ? { created_at: { gte: since } } : {} });
  return r._sum.cost_usd || 0;
}

// Spend recorded after the balance was entered (by row id, so nothing in the same second is miscounted).
async function spentAfterId(afterId: number) {
  const r = await prisma.ai_usage.aggregate({ _sum: { cost_usd: true }, where: { id: { gt: afterId } } });
  return r._sum.cost_usd || 0;
}

export async function creditStatus() {
  const balance = num(await settings.get('credit_balance_usd'));
  const setAt = (await settings.get('credit_balance_set_at')) || null;
  const threshold = num(await settings.get('credit_pause_below_usd'), 5) as number;
  const paused = (await settings.get('ai_paused')) === '1';
  const pauseReason = (await settings.get('ai_paused_reason')) || '';
  const afterId = num(await settings.get('credit_balance_after_id'), 0) as number;
  const spent = balance === null ? null : await spentAfterId(afterId);
  const remaining = balance === null ? null : Math.max(0, (balance as number) - (spent as number));
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const [today, week, month] = await Promise.all([spentSince(ago(1)), spentSince(ago(7)), spentSince(ago(30))]);
  const byFeature = await prisma.ai_usage.groupBy({
    by: ['feature'],
    where: { created_at: { gte: ago(30) } },
    _sum: { cost_usd: true, web_searches: true, input_tokens: true, output_tokens: true },
    _count: { _all: true },
  });
  const models = {
    writer: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    strategy: process.env.STRATEGY_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    factCheck: process.env.FACT_CHECK_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    assistant: process.env.ASSISTANT_MODEL || 'claude-opus-5-5',
  };
  return {
    balance,
    balanceSetAt: setAt,
    spentSinceBalance: spent,
    remaining,
    threshold,
    paused,
    pauseReason,
    spent: { last24h: today, last7d: week, last30d: month },
    byFeature: byFeature
      .map((f) => ({ feature: f.feature, calls: f._count._all, cost: f._sum.cost_usd || 0, webSearches: f._sum.web_searches || 0, inputTokens: f._sum.input_tokens || 0, outputTokens: f._sum.output_tokens || 0 }))
      .sort((a, b) => b.cost - a.cost),
    models,
    prices: Object.fromEntries(Object.values(models).map((m) => [m, priceFor(m)])),
    webSearchPer1000: WEB_SEARCH_PER_1000,
  };
}

export async function pauseAi(reason: string) {
  if ((await settings.get('ai_paused')) === '1') return;
  await settings.set('ai_paused', '1');
  await settings.set('ai_paused_reason', reason);
  await activity.log('ai.paused', { details: reason });
  // Pause any strategy that is generating; it continues after Resume.
  await prisma.seo_strategies.updateMany({ where: { status: 'generating' }, data: { status: 'paused', progress_stage: 'Paused: AI credits low' } });
}

export async function resumeAi(actor = 'system') {
  await settings.set('ai_paused', '0');
  await settings.set('ai_paused_reason', '');
  await activity.log('ai.resumed', { actor });
}

// New balance after a top-up: starts the count again and lifts the pause.
export async function setBalance(usd: number, actor = 'system', threshold?: number) {
  await settings.set('credit_balance_usd', String(usd));
  await settings.set('credit_balance_set_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
  const last = await prisma.ai_usage.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  await settings.set('credit_balance_after_id', String(last?.id ?? 0));
  if (threshold !== undefined && Number.isFinite(threshold)) await settings.set('credit_pause_below_usd', String(threshold));
  await activity.log('ai.balance_set', { details: `Balance set to $${usd.toFixed(2)}`, actor });
  await resumeAi(actor);
}

async function checkThreshold() {
  const s = await creditStatus();
  if (s.remaining !== null && s.remaining < s.threshold && !s.paused) {
    await pauseAi(`Estimated credit left ($${s.remaining.toFixed(2)}) is below the pause threshold ($${s.threshold.toFixed(2)}).`);
  }
}

// Called before every Claude request. Throws when AI work is paused.
export async function assertCredits() {
  await checkThreshold();
  if ((await settings.get('ai_paused')) === '1') {
    const reason = (await settings.get('ai_paused_reason')) || 'AI credits are low.';
    throw new CreditPausedError(`AI work is paused: ${reason} Add credits at console.anthropic.com, then enter the new balance in Settings > AI credits.`);
  }
}

// Anthropic's own "out of credit" answer pauses everything too.
export async function onApiError(err: any) {
  const raw = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`;
  if (/credit balance is too low|out of credit/i.test(raw)) await pauseAi('Anthropic reported that the account is out of credit.');
}

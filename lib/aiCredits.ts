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

// Real spend from Anthropic's Cost API, when an Admin API key (sk-ant-admin...) is set as
// ANTHROPIC_ADMIN_KEY. Daily buckets in USD cents (decimal strings); data lags about 5 minutes.
// Anthropic's cost report is asked at most once per 10 minutes: creditStatus runs before every
// Claude call and on every Settings refresh, and the report itself takes several requests.
const spendCache = new Map<string, { at: number; value: { usd: number; from: string } | null }>();
export async function anthropicSpend(sinceDay: string): Promise<{ usd: number; from: string } | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;
  const hit = spendCache.get(sinceDay);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const value = await fetchAnthropicSpend(key, sinceDay);
  spendCache.set(sinceDay, { at: Date.now(), value });
  return value;
}

async function fetchAnthropicSpend(key: string, sinceDay: string): Promise<{ usd: number; from: string } | null> {
  let total = 0;
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ starting_at: `${sinceDay}T00:00:00Z`, bucket_width: '1d', limit: '31' });
    if (page) q.set('page', page);
    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${q}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Anthropic cost report failed (${res.status})`);
    const json: any = await res.json();
    for (const b of json.data || []) for (const r of b.results || []) total += Number(r.amount || 0) / 100;
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }
  return { usd: total, from: sinceDay };
}

// One alert per balance when 80% of it has been used (Slack + Activity log + dashboard banner).
async function checkUsageAlert(s: { balance: number | null; spentSinceBalance: number | null; remaining: number | null; balanceSetAt: string | null }) {
  if (s.balance === null || !s.balance || s.spentSinceBalance === null) return;
  const used = s.spentSinceBalance / s.balance;
  if (used < 0.8) return;
  const stamp = `${s.balanceSetAt}|${s.balance}`;
  if ((await settings.get('credit_alert_80_for')) === stamp) return;
  await settings.set('credit_alert_80_for', stamp);
  const { notify } = await import('./notify');
  await notify(
    `AI credits: ${Math.round(used * 100)}% used`,
    `About $${(s.remaining ?? 0).toFixed(2)} of the $${s.balance.toFixed(2)} balance is left. Top up at console.anthropic.com (Settings > Billing; turn on auto-reload there so it never runs out), then enter the new balance in Settings > AI credits.`,
    { action: 'alert.credits_80' }
  );
}

export async function creditStatus() {
  const st = await settings.getMany(['credit_balance_usd', 'credit_balance_set_at', 'credit_pause_below_usd', 'ai_paused', 'ai_paused_reason', 'credit_balance_after_id']);
  const balance = num(st.credit_balance_usd);
  const setAt = st.credit_balance_set_at || null;
  const threshold = num(st.credit_pause_below_usd, 5) as number;
  const paused = st.ai_paused === '1';
  const pauseReason = st.ai_paused_reason || '';
  const afterId = num(st.credit_balance_after_id, 0) as number;
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
    secondCheck: process.env.SECOND_CHECK_MODEL || 'claude-sonnet-5-5',
    assistant: process.env.ASSISTANT_MODEL || 'claude-opus-5-5',
  };
  const actual = setAt ? await anthropicSpend(setAt.slice(0, 10)).catch((e) => ({ error: e.message })) : null;
  const usedPercent = balance && spent !== null ? Math.min(100, Math.round(((spent as number) / (balance as number)) * 100)) : null;
  return {
    balance,
    usedPercent,
    alert80: usedPercent !== null && usedPercent >= 80,
    actual,
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
  await checkUsageAlert(s).catch(() => {});
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

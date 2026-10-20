import { NextRequest, NextResponse } from 'next/server';
import { creditStatus, setBalance, resumeAi, pauseAi, autoResumeAi, spendWindow } from '@/lib/aiCredits';
import { checkKey } from '@/lib/anthropicClient';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';
import prisma from '@/lib/prisma';
import { strategyProgress } from '@/lib/strategy/progress';

export const runtime = 'nodejs';

// GET: models in use, estimated spend and remaining credit, pause state.
// ?days=N adds the spend of the last N days by kind of work and model.
export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(0, Number(req.nextUrl.searchParams.get('days')) || 0));
  // What is running or paused right now, so a deploy can wait for (or pause) work in progress.
  const [blogs, strategies] = await Promise.all([
    prisma.keywords.findMany({ where: { status: 'generating' }, select: { keyword: true } }),
    prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'paused', 'stopping'] } }, select: { id: true, status: true } }),
  ]);
  const running = { blogs: blogs.map((b) => b.keyword), strategies: strategies.map((s) => `#${s.id} ${s.status}`) };
  return NextResponse.json({ ...(await creditStatus()), running, month: await thisMonth(), ...(days ? { window: await spendWindow(days) } : {}) });
}

// This calendar month: what each kind of work has spent so far, and what the work still left in the
// approved strategy (blogs not yet written or checked, plus the daily work) should cost.
async function thisMonth() {
  const now = new Date();
  const since = `${now.toISOString().slice(0, 7)}-01 00:00:00`;
  const rows = await prisma.ai_usage.groupBy({ by: ['feature'], where: { created_at: { gte: since } }, _sum: { cost_usd: true } });
  const byFeature = rows.map((r: any) => ({ feature: r.feature, cost: r._sum.cost_usd || 0 })).sort((a, b) => b.cost - a.cost);
  const spent = byFeature.reduce((n, r) => n + r.cost, 0);
  const strategy = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' }, select: { id: true } });
  const p: any = strategy ? await strategyProgress(strategy.id).catch(() => null) : null;
  let remaining: { blogsLeft: number; perBlog: number; daysLeft: number; daily: number; cost: number } | null = null;
  if (p) {
    const unit = (item: string) => p.cost.lines.find((l: any) => l.item.startsWith(item))?.unitCost || 0;
    const blogsLeft = Math.max(0, p.blogs.total - p.blogs.published - p.blogs.inReview);
    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getUTCDate();
    const perBlog = unit('Blog writing') + unit('Fact checking');
    const daily = unit('Reports, meetings');
    remaining = { blogsLeft, perBlog, daysLeft, daily, cost: blogsLeft * perBlog + daysLeft * daily };
  }
  return { since, spent, byFeature, remaining, expectedTotal: spent + (remaining?.cost || 0) };
}

// POST { action: 'set_balance', balance, threshold? } after a top-up (also lifts the pause),
// { action: 'test_keys' }, { action: 'resume' } or { action: 'pause' }.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const actor = await getActor();
  if (body.action === 'set_balance') {
    const usd = Number(body.balance);
    if (!Number.isFinite(usd) || usd < 0) return NextResponse.json({ error: 'Enter the balance in US dollars.' }, { status: 400 });
    const threshold = body.threshold === undefined || body.threshold === '' ? undefined : Number(body.threshold);
    await setBalance(usd, actor, threshold);
  } else if (body.action === 'test_keys') {
    // Each key's answer from Anthropic; if one works while AI work is paused, work starts again.
    const keys = [await checkKey('main'), await checkKey('secondary')];
    const resumed = keys.some((k) => k.ok) ? await autoResumeAi().catch(() => null) : null;
    return NextResponse.json({ ...(await creditStatus()), keyTest: keys, resumed });
  } else if (body.action === 'resume') {
    await resumeAi(actor);
  } else if (body.action === 'pause') {
    await pauseAi(`Paused by ${actor}.`);
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json(await creditStatus());
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

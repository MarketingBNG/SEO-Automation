import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { needsExpertReview, publishPlan, reviewOverdue } from '@/lib/strategy/core';
import { expertReviewers, requireExpert } from '@/lib/reviewers';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// The Home page: what waits for a decision, what publishes next, what needs attention, and what
// went live recently. One call, a handful of small queries, no external services.
export async function GET() {
  const now = new Date();
  const [strategy, generating, failedKeywords, pendingKeywords, pendingDrafts, onCalendar, recentDrafts, aiPaused, aiPausedReason, creditStamp, creditAlert] = await Promise.all([
    prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' }, select: { id: true, period: true, end_date: true } }),
    prisma.seo_strategies.findFirst({ where: { status: { in: ['generating', 'paused', 'stopping', 'failed', 'pending_review'] } }, orderBy: { id: 'desc' }, select: { id: true, period: true, status: true, error: true } }),
    prisma.keywords.findMany({ where: { status: 'failed' }, select: { id: true, keyword: true, error: true }, orderBy: { id: 'desc' }, take: 10 }),
    prisma.keywords.count({ where: { status: 'pending' } }),
    // Drafts that wait for a review; the ones on the calendar are listed with their slot instead.
    prisma.drafts.findMany({ where: { status: 'pending_review' }, select: { id: true, title: true, author: true, updated_at: true, word_count: true, keyword: { select: { keyword: true } } }, orderBy: { id: 'desc' }, take: 40 }),
    prisma.blog_schedule.findMany({ where: { draft_id: { not: null } }, select: { draft_id: true } }),
    prisma.drafts.findMany({ where: { status: 'published', wp_post_url: { not: null } }, select: { id: true, title: true, wp_post_url: true, updated_at: true, author: true }, orderBy: { updated_at: 'desc' }, take: 6 }),
    settings.get('ai_paused'),
    settings.get('ai_paused_reason'),
    Promise.all([settings.get('credit_balance_set_at'), settings.get('credit_balance_usd')]).then((v) => v.join('|')),
    settings.get('credit_alert_80_for'),
  ]);

  const calendarDraftIds = new Set(onCalendar.map((r) => r.draft_id));
  const loose = pendingDrafts.filter((d) => !calendarDraftIds.has(d.id)).slice(0, 20);
  const rows = strategy ? await prisma.blog_schedule.findMany({ where: { strategy_id: strategy.id }, orderBy: { publish_at: 'asc' } }) : [];
  const expertOn = rows.length ? await requireExpert() : false;
  const reviewers = expertOn ? await expertReviewers() : [];
  const view = (r: any) => ({
    id: r.id,
    draft_id: r.draft_id,
    title: r.title,
    author: r.author,
    status: r.status,
    publish_at: r.publish_at,
    wp_post_url: r.wp_post_url,
    cover_url: r.draft_id ? `/api/drafts/${r.draft_id}/cover` : null,
    needs_expert: expertOn && needsExpertReview(r.main_keyword, r.title),
    overdue: reviewOverdue(r, now),
    reviewed_at: r.reviewed_at,
    reviewed_by: r.reviewed_by,
    fact_check: JSON.parse(r.fact_check || 'null'),
    hold_reasons: JSON.parse(r.hold_reasons || '[]'),
    cta: JSON.parse(r.cta || 'null'),
    publish_plan: publishPlan(r, now, { requireExpert: expertOn }),
  });

  const approvals = rows.filter((r) => ['in_review', 'held'].includes(r.status) && r.draft_id && !r.reviewed_at).map(view);
  const upcoming = rows.filter((r) => ['planned', 'drafting', 'in_review', 'held', 'revising', 'rejected'].includes(r.status) && !(['in_review', 'held'].includes(r.status) && !r.reviewed_at && r.draft_id)).slice(0, 8).map(view);

  const attention: { kind: string; title: string; detail: string; href: string }[] = [];
  if (aiPaused === '1') attention.push({ kind: 'credits', title: 'AI work is paused', detail: `${aiPausedReason || 'AI credits are low.'} Enter the new balance in Settings > AI credits.`, href: '/?tab=settings' });
  else if (creditAlert && creditAlert === creditStamp) attention.push({ kind: 'credits', title: 'AI credits: 80% used', detail: 'Top up at console.anthropic.com, then enter the new balance in Settings > AI credits.', href: '/?tab=settings' });
  if (!strategy) attention.push({ kind: 'strategy', title: 'No approved strategy', detail: generating ? `The ${generating.period} strategy is ${generating.status.replace('_', ' ')}${generating.error ? `: ${generating.error}` : ''}.` : 'Generate a strategy for the next 30 days and approve it; blogs, tracking and fixes start from there.', href: '/?tab=strategy' });
  else if (generating?.status === 'failed') attention.push({ kind: 'strategy', title: `Generating the ${generating.period} strategy failed`, detail: generating.error || 'See Monthly Strategy.', href: '/?tab=strategy' });
  for (const r of rows.filter((x) => x.status === 'held')) attention.push({ kind: 'held', title: `Held: ${r.title}`, detail: JSON.parse(r.hold_reasons || '[]').join(' ') || 'See Monthly Strategy.', href: r.draft_id ? `/?tab=drafts&draft=${r.draft_id}` : '/?tab=strategy' });
  for (const r of rows.filter((x) => x.status === 'failed')) attention.push({ kind: 'failed', title: `Publishing failed: ${r.title}`, detail: 'The activity log has the error. Fix the cause; the next check tries again.', href: '/?tab=strategy' });
  for (const r of approvals.filter((x) => x.overdue)) attention.push({ kind: 'overdue', title: `Review overdue: ${r.title}`, detail: 'It has waited more than 48 hours. Approve or reject it.', href: `/?tab=drafts&draft=${r.draft_id}` });
  if (failedKeywords.length) attention.push({ kind: 'keywords', title: `${failedKeywords.length} keyword blog${failedKeywords.length === 1 ? '' : 's'} failed`, detail: `${failedKeywords.slice(0, 3).map((k) => k.keyword).join(', ')}${failedKeywords.length > 3 ? ' and more' : ''}. Open Keywords and press "Try again".`, href: '/?tab=keywords' });

  return NextResponse.json({
    strategy: strategy ? { id: strategy.id, period: strategy.period, end_date: strategy.end_date } : null,
    reviewers,
    approvals,
    looseDrafts: loose.map((d) => ({ id: d.id, title: d.title, author: d.author, updated_at: d.updated_at, word_count: d.word_count, keyword: d.keyword?.keyword || null })),
    upcoming,
    attention,
    recent: recentDrafts,
    pendingKeywords,
    checkedAt: now.toISOString(),
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';
import { autoPublishAt, needsExpertReview, reviewOverdue, publishPlan } from '@/lib/strategy/core';
import { expertReviewers, requireExpert } from '@/lib/reviewers';

export const runtime = 'nodejs';

// The approved month's blog calendar with live status (planned, in review, held, published).
export async function GET() {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return NextResponse.json({ strategyId: null, rows: [] });
  const rows = await prisma.blog_schedule.findMany({ where: { strategy_id: s.id }, orderBy: { publish_at: 'asc' } });
  const expertOn = await requireExpert();
  const now = new Date();
  return NextResponse.json({ strategyId: s.id, reviewers: await expertReviewers(), rows: rows.map((r) => ({ ...r, cta: JSON.parse(r.cta || 'null'), publish_plan: publishPlan(r, now, { requireExpert: expertOn }), cover_url: r.draft_id ? `/api/drafts/${r.draft_id}/cover` : null, needs_expert: expertOn && needsExpertReview(r.main_keyword, r.title), overdue: reviewOverdue(r, now), tags: JSON.parse(r.tags), hold_reasons: JSON.parse(r.hold_reasons || '[]'), post_publish_log: JSON.parse(r.post_publish_log || 'null'), fact_check: JSON.parse(r.fact_check || 'null'), revision_note: JSON.parse(r.revision_note || 'null'), auto_publish_at: r.status === 'in_review' && !(expertOn && !r.reviewed_at && needsExpertReview(r.main_keyword, r.title)) ? new Date(autoPublishAt(r)).toISOString() : null })) });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

// Which calendar rows the dashboard shows: every row of the newest approved strategy, plus the rows
// of an older approved strategy (an earlier 30-day window) that are not live yet. The autopilot
// works on those too, so a reviewer must still see them to approve, reject or pause them.
import prisma from '../prisma';

export async function calendarRowsWhere(latestId: number) {
  const approved = await prisma.seo_strategies.findMany({ where: { status: 'approved' }, select: { id: true } });
  const older = approved.map((s) => s.id).filter((id) => id !== latestId);
  return older.length ? { OR: [{ strategy_id: latestId }, { strategy_id: { in: older }, status: { not: 'published' } }] } : { strategy_id: latestId };
}

// The approved month's blog calendar with live status (planned, in review, held, published), as
// GET /api/strategy/schedule returns it (also read by the assistant's list_calendar).
export async function calendarView() {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return { strategyId: null, rows: [] };
  const { autoPublishAt, needsExpertReview, reviewOverdue, publishPlan } = await import('./core');
  const { expertReviewers, requireExpert } = await import('../reviewers');
  // Blogs of an older approved month that are not live yet are still run by the autopilot: shown too.
  const rows = await prisma.blog_schedule.findMany({ where: await calendarRowsWhere(s.id), orderBy: { publish_at: 'asc' } });
  const expertOn = await requireExpert();
  const now = new Date();
  return { strategyId: s.id, reviewers: await expertReviewers(), rows: rows.map((r) => ({ ...r, cta: JSON.parse(r.cta || 'null'), publish_plan: publishPlan(r, now, { requireExpert: expertOn }), cover_url: r.draft_id ? `/api/drafts/${r.draft_id}/cover` : null, needs_expert: expertOn && needsExpertReview(r.main_keyword, r.title), overdue: reviewOverdue(r, now), tags: JSON.parse(r.tags), hold_reasons: JSON.parse(r.hold_reasons || '[]'), post_publish_log: JSON.parse(r.post_publish_log || 'null'), fact_check: JSON.parse(r.fact_check || 'null'), revision_note: JSON.parse(r.revision_note || 'null'), auto_publish_at: r.status === 'in_review' && !(expertOn && !r.reviewed_at && needsExpertReview(r.main_keyword, r.title)) ? new Date(autoPublishAt(r)).toISOString() : null })) };
}

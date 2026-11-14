// Meeting insights: a reviewer approves, rejects or edits the cleaned overview of a client meeting.
// Shared by PATCH /api/client-insights/[id] and the assistant's meeting_insight_review.
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { sqlNow } from '@/lib/time';

export async function reviewInsight(nid: number, { status, overview }: any, actor: string): Promise<{ status: number; body: any }> {
  const existing = await prisma.client_insights.findUnique({ where: { id: nid } });
  if (!existing || existing.status === 'deleted') return { status: 404, body: { error: 'Not found' } };
  if (status && !['approved', 'rejected', 'pending_review'].includes(status)) {
    return { status: 400, body: { error: 'invalid status' } };
  }
  // Was: overview = COALESCE(?, overview), status = COALESCE(?, status),
  //      decided_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE decided_at END
  const data: any = {};
  if (overview != null) data.overview = overview;
  if (status != null) {
    data.status = status;
    data.decided_at = sqlNow();
  }
  if (Object.keys(data).length) await prisma.client_insights.update({ where: { id: nid }, data });
  const updated: any = await prisma.client_insights.findUnique({ where: { id: nid } });
  if (status) {
    await activity.log(`client_insight.${status}`, { entityType: 'client_insight', entityId: nid, details: updated.title || '(untitled meeting)', actor });
  }
  return { status: 200, body: updated };
}

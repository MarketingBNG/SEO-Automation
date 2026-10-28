// Which calendar rows the dashboard shows: every row of the newest approved strategy, plus the rows
// of an older approved strategy (an earlier 30-day window) that are not live yet. The autopilot
// works on those too, so a reviewer must still see them to approve, reject or pause them.
import prisma from '../prisma';

export async function calendarRowsWhere(latestId: number) {
  const approved = await prisma.seo_strategies.findMany({ where: { status: 'approved' }, select: { id: true } });
  const older = approved.map((s) => s.id).filter((id) => id !== latestId);
  return older.length ? { OR: [{ strategy_id: latestId }, { strategy_id: { in: older }, status: { not: 'published' } }] } : { strategy_id: latestId };
}

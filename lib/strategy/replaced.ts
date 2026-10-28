// @ts-nocheck -- takes a Prisma client or a transaction client.
// What happens to the blogs of a replaced (superseded) strategy: blogs not written yet are removed
// (their keywords freed), and started ones are paused for a person to decide. Used when a new
// version is approved, and on every scheduler run for strategies replaced earlier (also before this
// rule existed) and for a row whose draft was still being written when its strategy was replaced.
import prisma from '../prisma';
import { keywordKey } from './core';

// Statuses a replaced strategy's row is stopped from. A row being written ('drafting', 'revising')
// is left alone: once the write ends it is 'planned' or 'rejected' and the next run stops it.
export const REPLACED_STOP = ['planned', 'in_review', 'held', 'rejected'];
export const REPLACED_BY = 'Automatic (strategy replaced)';

export async function stopReplacedRows(db: any, oldIds: number[], reasonText: string, now: string) {
  if (!oldIds.length) return { removed: [], paused: [] };
  const unwritten = await db.blog_schedule.findMany({ where: { strategy_id: { in: oldIds }, status: 'planned', draft_id: null }, select: { id: true, main_keyword: true } });
  if (unwritten.length) {
    // A keyword another (not removed) row still uses stays reserved.
    const keys = [...new Set(unwritten.map((r) => keywordKey(r.main_keyword)))];
    const others = await db.blog_schedule.findMany({ where: { id: { notIn: unwritten.map((r) => r.id) } }, select: { main_keyword: true } });
    const inUse = new Set(others.map((r) => keywordKey(r.main_keyword)));
    const free = keys.filter((k) => !inUse.has(k));
    if (free.length) await db.strategy_keywords.deleteMany({ where: { strategy_id: { in: oldIds }, keyword_key: { in: free } } });
    await db.blog_schedule.deleteMany({ where: { id: { in: unwritten.map((r) => r.id) } } });
  }
  const reason = JSON.stringify([reasonText]);
  const started = await db.blog_schedule.findMany({ where: { strategy_id: { in: oldIds }, status: { in: REPLACED_STOP } }, select: { id: true, status: true, title: true } });
  for (const r of started) {
    await db.blog_schedule.update({ where: { id: r.id }, data: { status: 'paused', paused_from: r.status, paused_by: REPLACED_BY, hold_reasons: reason, updated_at: now } });
  }
  return { removed: unwritten, paused: started };
}

// The scheduler's pass over every superseded strategy. Idempotent: a paused row is not matched again.
export async function stopSupersededRows(now: string, db: any = prisma) {
  const ids = (await db.seo_strategies.findMany({ where: { status: 'superseded' }, select: { id: true } })).map((s) => s.id);
  return stopReplacedRows(db, ids, 'Its strategy was replaced by a newer approved version, so the autopilot no longer publishes it. To keep it, publish its draft from Drafts & Review.', now);
}

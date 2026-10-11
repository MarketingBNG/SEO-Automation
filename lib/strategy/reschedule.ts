// Pause, resume and reschedule a calendar blog, and suggest good new publish times.
import prisma from '../prisma';
import { REVIEW_HOURS } from './core';

const H = 3600000;
const toMs = (s: string) => Date.parse(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
export const toSql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const istDate = (ms: number) => new Date(ms + 5.5 * H).toISOString().slice(0, 10);

// States a blog can be paused from. A blog being written or rewritten right now cannot be paused.
export const PAUSABLE = ['planned', 'in_review', 'held', 'rejected'];

// The earliest a blog can sensibly go live: a new draft needs writing plus the full review; a draft
// in review needs its review to finish; an approved one can go soon.
export function earliestPublish(row: { draft_id: number | null; reviewed_at: string | null; review_started: string | null; status: string }, now = new Date()) {
  const t = now.getTime();
  if (!row.draft_id || row.status === 'rejected') return t + (REVIEW_HOURS + 4) * H;
  if (row.reviewed_at) return t + 1 * H;
  const reviewEnds = row.review_started ? toMs(row.review_started) + REVIEW_HOURS * H : t + REVIEW_HOURS * H;
  return Math.max(t + 2 * H, reviewEnds);
}

export type Suggestion = { at: string; label: string; why: string };

// Up to five new times: at the blog's planned time of day, on days the strategy uses for blogs,
// on days with no other blog, from the earliest workable moment over the next three weeks.
export async function suggestSlots(row: any, now = new Date()): Promise<Suggestion[]> {
  const others = await prisma.blog_schedule.findMany({ where: { strategy_id: row.strategy_id, id: { not: row.id }, status: { notIn: ['failed'] } }, select: { publish_at: true } });
  const busy = new Set(others.map((o) => istDate(toMs(o.publish_at))));
  const weekdays = new Set([row, ...others].map((o) => new Date(toMs(o.publish_at) + 5.5 * H).getUTCDay()));
  const slot = new Date(toMs(row.publish_at));
  const earliest = earliestPublish(row, now);
  const out: Suggestion[] = [];
  const pick = (strictWeekday: boolean) => {
    for (let d = 0; d < 21 && out.length < 5; d++) {
      const day = new Date(earliest + d * 24 * H);
      day.setUTCHours(slot.getUTCHours(), slot.getUTCMinutes(), 0, 0);
      let ms = day.getTime();
      if (ms < earliest) ms += 24 * H;
      const date = istDate(ms);
      const wd = new Date(ms + 5.5 * H).getUTCDay();
      if (busy.has(date) || out.some((o) => istDate(toMs(o.at)) === date)) continue;
      if (strictWeekday && !weekdays.has(wd)) continue;
      out.push({
        at: toSql(ms),
        label: new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST',
        why: `${out.length === 0 ? 'Earliest free day' : 'Free day'}, same time as the plan${strictWeekday ? ', on a blog day of the strategy' : ''}`,
      });
    }
  };
  pick(true);
  if (out.length < 3) pick(false);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

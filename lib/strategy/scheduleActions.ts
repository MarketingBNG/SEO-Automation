// What a person can do to a blog on the monthly calendar (Blog Calendar on Home, Monthly Strategy).
// Shared by PATCH /api/strategy/schedule/[id] and the assistant's calendar tools, so both run the
// same checks. Each returns { status, body } exactly as the route answers.
//   { action: 'approve', reviewer }       publishes at its slot (or now, if the slot has passed).
//                                         Tax, legal and compliance blogs need a CA/CPA reviewer name.
//   { action: 'reject', feedback: '...' } the blog is rewritten with the feedback and comes back for review
//   { action: 'pause' }                   stops everything for this blog until it is resumed
//   { action: 'resume' }                  goes back to where it was (needs a new time if its slot passed)
//   { action: 'publish_now' }             a reviewed or approved blog goes live at once
//   { action: 'mark_done', url? }         published outside the dashboard: nothing tries it again
//   { action: 'reschedule', publishAt }   moves it to a new time (UTC 'YYYY-MM-DD HH:MM:SS' or ISO);
//                                         a paused blog is resumed at the same time
// Doing nothing for 48 hours approves it automatically.
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { canDo } from '@/lib/access';
import { deniedMessage, type Role } from '@/lib/permissions';
import { sqlNow } from '@/lib/time';
import { aiLeftovers, needsExpertReview } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';
import { PAUSABLE, earliestPublish, suggestSlots, toSql } from '@/lib/strategy/reschedule';

export type ScheduleMe = { email: string; role: Role; blocked?: boolean } | null;
export type ScheduleResult = { status: number; body: any };
const res = (body: any, status = 200): ScheduleResult => ({ status, body });

export const SCHEDULE_ACTIONS = ['approve', 'reject', 'pause', 'resume', 'publish_now', 'mark_done', 'reschedule'] as const;

export async function decideSchedule(id: number, input: any, { me, actor }: { me: ScheduleMe; actor: string }): Promise<ScheduleResult> {
  const { action, feedback, reviewer, publishAt, url: postUrl }: any = input || {};
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) return res({ error: 'Not found' }, 404);
  if (row.status === 'published') return res({ error: 'Already published' }, 409);

  if (action === 'approve' || action === 'reviewed') {
    if (!['in_review', 'held', 'planned'].includes(row.status) || !row.draft_id) return res({ error: 'This blog has no draft to approve yet.' }, 409);
    const draft = await prisma.drafts.findUnique({ where: { id: row.draft_id } });
    const leftovers = aiLeftovers(draft?.title, draft?.meta_description, draft?.content_html);
    if (leftovers.length) return res({ error: `This draft cannot be approved yet. ${leftovers.join(' ')} Edit it in Drafts & Review first.` }, 409);
    const expert = String(reviewer || '').trim();
    if ((await requireExpert()) && needsExpertReview(row.main_keyword, row.title)) {
      const known = await expertReviewers();
      if (!expert) return res({ error: 'This is a tax, legal or compliance blog. Pick the CA/CPA who reviewed it.', reviewers: known }, 400);
      if (!known.includes(expert) && !CREDENTIAL.test(expert)) return res({ error: 'Give the reviewer as "Name, credential" (for example "Akshay Nahar, CA"), so the byline can name them.' }, 400);
    }
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { reviewed_by: actor, reviewed_at: sqlNow(), expert_reviewer: expert || null, updated_at: sqlNow() } });
    await prisma.drafts.update({ where: { id: row.draft_id }, data: { status: 'approved', updated_at: sqlNow() } }).catch(() => {});
    await activity.log('schedule.approved', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" approved${expert ? ` (reviewed by ${expert})` : ''}; publishes at its slot`, actor });
    return res(updated);
  }

  if (action === 'reject') {
    const text = String(feedback || '').trim();
    if (text.length < 10) return res({ error: 'Say what should change (at least a sentence), so the rewrite can fix it.' }, 400);
    if (!['in_review', 'held'].includes(row.status)) return res({ error: 'Only a blog in review can be rejected.' }, 409);
    const updated = await prisma.blog_schedule.update({
      where: { id },
      data: { status: 'rejected', reject_feedback: text.slice(0, 4000), rejected_by: actor, reviewed_at: null, reviewed_by: null, updated_at: sqlNow() },
    });
    if (row.draft_id) await prisma.drafts.update({ where: { id: row.draft_id }, data: { status: 'rejected', updated_at: sqlNow() } }).catch(() => {});
    await activity.log('schedule.rejected', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" rejected: ${text.slice(0, 200)}`, actor });
    // The Writer agent remembers what the reviewer did not want, for every blog after this one.
    await import('@/lib/agentMemory').then((m) => m.remember({ agent: 'writer', kind: 'mistake', title: `Reviewer: ${text.slice(0, 140)}`, body: `A reviewer rejected "${row.title}": ${text.slice(0, 1200)}`, source: 'review', sourceRef: `schedule:${id}`, by: actor })).catch(() => {});
    return res(updated);
  }
  // "Already done": the blog was published outside the dashboard, so nothing should try it again.
  // { action: 'mark_done', url? } where url is the live post, if there is one.
  if (action === 'mark_done') {
    if (!me || !(await canDo(me, 'blog.publish_now'))) return res({ error: deniedMessage('blog.publish_now') }, 403);
    if (['drafting', 'revising'].includes(row.status)) return res({ error: 'It is being written right now. Try again in a few minutes.' }, 409);
    const url = String(postUrl || '').trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) return res({ error: 'Give the full post address starting with https://, or leave it empty.' }, 400);
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { status: 'published', wp_post_url: url || row.wp_post_url, paused_from: null, paused_by: null, hold_reasons: null, updated_at: sqlNow() } });
    await activity.log('schedule.marked_done', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}": marked as already done${url ? ` (${url})` : ''}`, actor });
    return res(updated);
  }

  if (action === 'pause') {
    if (!PAUSABLE.includes(row.status)) return res({ error: row.status === 'paused' ? 'Already paused.' : 'It is being written right now. Pause it in a few minutes.' }, 409);
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { status: 'paused', paused_from: row.status, paused_by: actor, updated_at: sqlNow() } });
    await activity.log('schedule.paused', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" paused (was ${row.status})`, actor });
    return res(updated);
  }

  if (action === 'resume') {
    if (row.status !== 'paused') return res({ error: 'It is not paused.' }, 409);
    const back = row.paused_from || 'planned';
    if (Date.parse(row.publish_at.replace(' ', 'T') + 'Z') < earliestPublish({ ...row, status: back })) {
      return res({ error: 'Its publish time is too close or has passed. Pick a new time.', needsReschedule: true, suggestions: await suggestSlots({ ...row, status: back }) }, 409);
    }
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { status: back, paused_from: null, paused_by: null, updated_at: sqlNow() } });
    await activity.log('schedule.resumed', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" resumed`, actor });
    return res(updated);
  }

  if (action === 'publish_now') {
    // Publishing at once is the admin's or a manager's call (or anyone given "Publish now" access).
    if (!me || !(await canDo(me, 'blog.publish_now'))) return res({ error: deniedMessage('blog.publish_now') }, 403);
    try {
      const { publishScheduleNow } = await import('@/lib/strategy/autopilot');
      const r = await publishScheduleNow(id, actor);
      if (r.result !== 'published') return res({ error: `Not published. ${r.hold_reasons.join(' ') || 'It was held; see its status.'}`, ...r }, 409);
      return res(r);
    } catch (e: any) {
      await activity.log('schedule.publish_failed', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}": ${String(e.message || e).slice(0, 300)}`, actor }).catch(() => {});
      return res({ error: e.message }, e.status || 500);
    }
  }

  if (action === 'reschedule') {
    if (['drafting', 'revising'].includes(row.status)) return res({ error: 'It is being written right now. Reschedule it in a few minutes.' }, 409);
    const raw = String(publishAt || '');
    const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(ms)) return res({ error: 'Pick a date and time.' }, 400);
    if (ms < Date.now() + 30 * 60000) return res({ error: 'Pick a time at least 30 minutes from now.' }, 400);
    const back = row.status === 'paused' ? row.paused_from || 'planned' : row.status;
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { publish_at: toSql(ms), status: back, paused_from: null, paused_by: null, reminded_at: null, updated_at: sqlNow() } });
    const early = ms < earliestPublish({ ...row, status: back });
    await activity.log('schedule.rescheduled', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" moved from ${row.publish_at} to ${toSql(ms)} UTC`, actor });
    return res({ ...updated, note: early ? 'This is earlier than its writing and 48-hour review can finish, so it publishes when the review ends.' : null });
  }
  return res({ error: 'action must be approve, reject, pause, resume, publish_now or reschedule' }, 400);
}

// Suggested new publish times for one calendar blog (GET /api/strategy/schedule/[id]).
export async function scheduleSuggestions(id: number): Promise<ScheduleResult> {
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) return res({ error: 'Not found' }, 404);
  const back = row.status === 'paused' ? row.paused_from || 'planned' : row.status;
  return res({ suggestions: await suggestSlots({ ...row, status: back }), earliest: new Date(earliestPublish({ ...row, status: back })).toISOString() });
}

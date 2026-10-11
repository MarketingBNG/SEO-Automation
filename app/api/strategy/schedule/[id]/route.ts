import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { aiLeftovers, needsExpertReview } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';
import { PAUSABLE, earliestPublish, suggestSlots, toSql } from '@/lib/strategy/reschedule';

export const runtime = 'nodejs';

// A reviewer decides on a blog in its 48-hour review:
//   { action: 'approve', reviewer }       publishes at its slot (or now, if the slot has passed).
//                                         Tax, legal and compliance blogs need a CA/CPA reviewer name.
//   { action: 'reject', feedback: '...' } the blog is rewritten with the feedback and comes back for review
//   { action: 'pause' }                   stops everything for this blog until it is resumed
//   { action: 'resume' }                  goes back to where it was (needs a new time if its slot passed)
//   { action: 'reschedule', publishAt }   moves it to a new time (UTC 'YYYY-MM-DD HH:MM:SS' or ISO);
//                                         a paused blog is resumed at the same time
// Doing nothing for 48 hours approves it automatically.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const { action, feedback, reviewer, publishAt }: any = (await req.json().catch(() => ({}))) || {};
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'published') return NextResponse.json({ error: 'Already published' }, { status: 409 });
  const actor = await getActor();

  if (action === 'approve' || action === 'reviewed') {
    if (!['in_review', 'held', 'planned'].includes(row.status) || !row.draft_id) return NextResponse.json({ error: 'This blog has no draft to approve yet.' }, { status: 409 });
    const draft = await prisma.drafts.findUnique({ where: { id: row.draft_id } });
    const leftovers = aiLeftovers(draft?.title, draft?.meta_description, draft?.content_html);
    if (leftovers.length) return NextResponse.json({ error: `This draft cannot be approved yet. ${leftovers.join(' ')} Edit it in Drafts & Review first.` }, { status: 409 });
    const expert = String(reviewer || '').trim();
    if ((await requireExpert()) && needsExpertReview(row.main_keyword, row.title)) {
      const known = await expertReviewers();
      if (!expert) return NextResponse.json({ error: 'This is a tax, legal or compliance blog. Pick the CA/CPA who reviewed it.', reviewers: known }, { status: 400 });
      if (!known.includes(expert) && !CREDENTIAL.test(expert)) return NextResponse.json({ error: 'Give the reviewer as "Name, credential" (for example "Akshay Nahar, CA"), so the byline can name them.' }, { status: 400 });
    }
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { reviewed_by: actor, reviewed_at: sqlNow(), expert_reviewer: expert || null, updated_at: sqlNow() } });
    await prisma.drafts.update({ where: { id: row.draft_id }, data: { status: 'approved', updated_at: sqlNow() } }).catch(() => {});
    await activity.log('schedule.approved', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" approved${expert ? ` (reviewed by ${expert})` : ''}; publishes at its slot`, actor });
    return NextResponse.json(updated);
  }

  if (action === 'reject') {
    const text = String(feedback || '').trim();
    if (text.length < 10) return NextResponse.json({ error: 'Say what should change (at least a sentence), so the rewrite can fix it.' }, { status: 400 });
    if (!['in_review', 'held'].includes(row.status)) return NextResponse.json({ error: 'Only a blog in review can be rejected.' }, { status: 409 });
    const updated = await prisma.blog_schedule.update({
      where: { id },
      data: { status: 'rejected', reject_feedback: text.slice(0, 4000), rejected_by: actor, reviewed_at: null, reviewed_by: null, updated_at: sqlNow() },
    });
    if (row.draft_id) await prisma.drafts.update({ where: { id: row.draft_id }, data: { status: 'rejected', updated_at: sqlNow() } }).catch(() => {});
    await activity.log('schedule.rejected', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" rejected: ${text.slice(0, 200)}`, actor });
    return NextResponse.json(updated);
  }
  if (action === 'pause') {
    if (!PAUSABLE.includes(row.status)) return NextResponse.json({ error: row.status === 'paused' ? 'Already paused.' : 'It is being written right now. Pause it in a few minutes.' }, { status: 409 });
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { status: 'paused', paused_from: row.status, paused_by: actor, updated_at: sqlNow() } });
    await activity.log('schedule.paused', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" paused (was ${row.status})`, actor });
    return NextResponse.json(updated);
  }

  if (action === 'resume') {
    if (row.status !== 'paused') return NextResponse.json({ error: 'It is not paused.' }, { status: 409 });
    const back = row.paused_from || 'planned';
    if (Date.parse(row.publish_at.replace(' ', 'T') + 'Z') < earliestPublish({ ...row, status: back })) {
      return NextResponse.json({ error: 'Its publish time is too close or has passed. Pick a new time.', needsReschedule: true, suggestions: await suggestSlots({ ...row, status: back }) }, { status: 409 });
    }
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { status: back, paused_from: null, paused_by: null, updated_at: sqlNow() } });
    await activity.log('schedule.resumed', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" resumed`, actor });
    return NextResponse.json(updated);
  }

  if (action === 'reschedule') {
    if (['drafting', 'revising'].includes(row.status)) return NextResponse.json({ error: 'It is being written right now. Reschedule it in a few minutes.' }, { status: 409 });
    const raw = String(publishAt || '');
    const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(ms)) return NextResponse.json({ error: 'Pick a date and time.' }, { status: 400 });
    if (ms < Date.now() + 30 * 60000) return NextResponse.json({ error: 'Pick a time at least 30 minutes from now.' }, { status: 400 });
    const back = row.status === 'paused' ? row.paused_from || 'planned' : row.status;
    const updated = await prisma.blog_schedule.update({ where: { id }, data: { publish_at: toSql(ms), status: back, paused_from: null, paused_by: null, reminded_at: null, updated_at: sqlNow() } });
    const early = ms < earliestPublish({ ...row, status: back });
    await activity.log('schedule.rescheduled', { entityType: 'blog_schedule', entityId: id, details: `"${row.title}" moved from ${row.publish_at} to ${toSql(ms)} UTC`, actor });
    return NextResponse.json({ ...updated, note: early ? 'This is earlier than its writing and 48-hour review can finish, so it publishes when the review ends.' : null });
  }
  return NextResponse.json({ error: 'action must be approve, reject, pause, resume or reschedule' }, { status: 400 });
}

// GET: suggested new publish times for this blog.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const row = await prisma.blog_schedule.findUnique({ where: { id: toId((await params).id) } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const back = row.status === 'paused' ? row.paused_from || 'planned' : row.status;
  return NextResponse.json({ suggestions: await suggestSlots({ ...row, status: back }), earliest: new Date(earliestPublish({ ...row, status: back })).toISOString() });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

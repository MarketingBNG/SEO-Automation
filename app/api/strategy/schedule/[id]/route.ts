import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { aiLeftovers, needsExpertReview } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';

export const runtime = 'nodejs';

// A reviewer decides on a blog in its 48-hour review:
//   { action: 'approve', reviewer }       publishes at its slot (or now, if the slot has passed).
//                                         Tax, legal and compliance blogs need a CA/CPA reviewer name.
//   { action: 'reject', feedback: '...' } the blog is rewritten with the feedback and comes back for review
// Doing nothing for 48 hours approves it automatically.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const { action, feedback, reviewer }: any = (await req.json().catch(() => ({}))) || {};
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
      if (!known.includes(expert) && !CREDENTIAL.test(expert)) return NextResponse.json({ error: 'Give the reviewer as "Name, credential" (for example "Akshay Nahar, CA"), or add them in Settings > Expert reviewers.' }, { status: 400 });
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
  return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

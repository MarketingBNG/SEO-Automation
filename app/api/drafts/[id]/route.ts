import { checklistState } from '@/lib/publishChecklist';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { wordsHash } from '@/lib/factCheckMark';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../_lib/http';
import { needsExpertReview, publishPlan } from '@/lib/strategy/core';
import { requireExpert } from '@/lib/reviewers';
import { seoSlug } from '@/lib/site';
import { publicSite } from '@/lib/siteConnector';
import { coverAlt } from '@/lib/cover';
import { DRAFT_TOKEN_ACTOR, hasDraftToken } from '@/lib/draftToken';
import { authorNames } from '@/lib/authors';
import { patchDraft, deleteDraft } from '@/lib/draftActions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  // Was: SELECT drafts.*, keywords.keyword AS keyword FROM drafts LEFT JOIN keywords ... WHERE drafts.id = ?
  const found: any = await prisma.drafts.findUnique({ where: { id: nid }, include: { keyword: { select: { keyword: true } } } });
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { keyword, ...rest } = found;
  const row = { ...rest, keyword: keyword?.keyword ?? null };
  const [facts, sched] = await Promise.all([
    prisma.facts.findMany({ where: { draft_id: nid }, orderBy: { id: 'asc' } }),
    prisma.blog_schedule.findFirst({ where: { draft_id: nid } }),
  ]);
  // Its place on the monthly calendar (when it publishes, under whom), for the review screen.
  const expertOn = sched ? await requireExpert() : false;
  const schedule = sched
    ? {
        id: sched.id,
        strategy_id: sched.strategy_id,
        status: sched.status,
        publish_at: sched.publish_at,
        reviewed_at: sched.reviewed_at,
        reviewed_by: sched.reviewed_by,
        expert_reviewer: sched.expert_reviewer,
        author: sched.author,
        cta: JSON.parse(sched.cta || 'null'),
        hold_reasons: JSON.parse(sched.hold_reasons || '[]'),
        wp_post_url: sched.wp_post_url,
        needs_expert: expertOn && needsExpertReview(sched.main_keyword, sched.title),
        publish_plan: publishPlan(sched, new Date(), { requireExpert: expertOn }),
      }
    : null;
  const site = publicSite();
  const planned_url = found.wp_post_url || `${site}/${seoSlug(sched?.main_keyword || row.keyword || found.title || '')}/`;
  return NextResponse.json({ ...row, text_hash: wordsHash(found), facts, schedule, planned_url, cover_alt_shown: coverAlt(found), author_options: await authorNames(), checklist: await checklistState(found) }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body: any = (await req.json().catch(() => ({}))) || {};
  // Claude Code edits words only; approving, rejecting and publishing stay with a signed-in person.
  const viaToken = hasDraftToken(req);
  const r = await patchDraft(toId(id), body, { actor: viaToken ? DRAFT_TOKEN_ACTOR : await getActor(), viaToken });
  return NextResponse.json(r.body, { status: r.status });
}

// Deletes a draft that will not be published (see lib/draftActions.ts). A website post that was
// already created from this draft is NOT touched.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const r = await deleteDraft(toId(id), { actor: await getActor() });
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT };

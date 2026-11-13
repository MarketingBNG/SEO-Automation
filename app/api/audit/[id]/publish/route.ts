import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updatePost, publishPost, seoSlug, postStatus, siteConfigured, draftsRefused, SITE_NOT_SET_UP } from '@/lib/site';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { faqAccordion } from '@/lib/strategy/core';

export const runtime = 'nodejs';

// Publishes an audit's rewrite to the website. If the audit came from a live post (wp_post_id set),
// 'publish' REPLACES that post in place. 'draft' (only while the website keeps drafts hidden,
// SITE_CONNECTOR_DRAFTS=on) makes a separate website draft, so the live post stays online and
// unchanged. Otherwise it creates a new post.
// The separate draft saved earlier is still on the website and not live. Only "not on the website"
// means it is gone: any other failure (timeout, 5xx) is thrown, so the save fails and can be retried
// instead of making a second draft and losing track of the first.
async function draftStillThere(id: number): Promise<boolean> {
  return (await postStatus(id)) === 'draft';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const audit: any = await prisma.blog_audits.findUnique({ where: { id: nid } });
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  if (!audit.rewrite_content_html) {
    return NextResponse.json({ error: 'No rewrite to publish yet. Run "Rewrite" first.' }, { status: 400 });
  }
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(audit.rewrite_content_html)) {
    return NextResponse.json({ error: 'The rewrite still has a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]). Replace or remove it before publishing.' }, { status: 400 });
  }

  const body: any = await req.json().catch(() => ({}));
  const wpStatus = (body && body.wpStatus) || 'publish';
  // Only these two: 'pending', 'private' or 'future' on a live post would take it off the website.
  if (!['publish', 'draft'].includes(wpStatus)) {
    return NextResponse.json({ error: 'wpStatus must be "publish" or "draft".' }, { status: 400 });
  }

  // Without the website connection nothing can go out.
  if (!siteConfigured()) {
    await activity
      .log('audit.rewrite_publish_failed', { entityType: 'blog_audit', entityId: nid, details: `"${audit.rewrite_title || audit.title || ''}": ${SITE_NOT_SET_UP}`, actor: await getActor() })
      .catch(() => {});
    return NextResponse.json({ error: SITE_NOT_SET_UP }, { status: 503 });
  }
  const noDraft = draftsRefused(wpStatus);
  if (noDraft) return NextResponse.json({ error: noDraft }, { status: 400 });

  try {
    let post: any;
    // A live post must never be switched to draft: that takes it off the website.
    const separateDraft = Boolean(audit.wp_post_id) && wpStatus === 'draft';
    if (audit.wp_post_id && !separateDraft) {
      // Existing post: keep its URL (no slug change), refresh content and the meta description.
      post = await updatePost(audit.wp_post_id, {
        title: audit.rewrite_title,
        contentHtml: faqAccordion(audit.rewrite_content_html),
        excerpt: audit.rewrite_meta || undefined,
        status: wpStatus,
        metaDescription: audit.rewrite_meta,
      } as any);
    } else if (separateDraft && audit.rewrite_wp_draft_id && (await draftStillThere(audit.rewrite_wp_draft_id))) {
      // Sent as a separate draft before: that draft is updated, so no second website draft is made.
      post = await updatePost(audit.rewrite_wp_draft_id, {
        title: audit.rewrite_title,
        contentHtml: faqAccordion(audit.rewrite_content_html),
        excerpt: audit.rewrite_meta || undefined,
        status: 'draft',
        metaDescription: audit.rewrite_meta,
      } as any);
    } else {
      post = await publishPost({
        title: audit.rewrite_title,
        contentHtml: faqAccordion(audit.rewrite_content_html),
        excerpt: audit.rewrite_meta || '',
        status: wpStatus,
        slug: seoSlug(audit.rewrite_title),
        metaDescription: audit.rewrite_meta,
      } as any);
    }

    // The live post now carries the rewrite, so a separate draft sent earlier is forgotten (the
    // website offers no delete: it stays hidden there as a draft).
    const forgetDraft = !separateDraft && audit.wp_post_id && audit.rewrite_wp_draft_id ? { rewrite_wp_draft_id: null, rewrite_wp_draft_url: null } : {};

    // The separate draft's address and id are kept, so the audit page links to it after a reload.
    await prisma.blog_audits.update({
      where: { id: nid },
      data: separateDraft ? { rewrite_status: 'sent_as_draft', rewrite_wp_draft_url: post.link || null, rewrite_wp_draft_id: post.id ?? null } : { rewrite_status: 'published', ...forgetDraft },
    });

    await activity.log('audit.rewrite_published', {
      entityType: 'blog_audit',
      entityId: Number(id),
      details: `"${audit.rewrite_title}" → ${post.link} (${wpStatus}, ${separateDraft ? 'separate draft, live post unchanged' : audit.wp_post_id ? 'replaced existing' : 'new post'})`,
      actor: await getActor(),
    });

    if (separateDraft) return NextResponse.json({ ok: true, draft: { link: post.link } }, { status: 200 });
    return NextResponse.json({ ok: true, wpPostUrl: post.link }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    await activity
      .log('audit.rewrite_publish_failed', { entityType: 'blog_audit', entityId: nid, details: `"${audit.rewrite_title || audit.title || ''}": ${String(err.message || err).slice(0, 300)}`, actor: await getActor() })
      .catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

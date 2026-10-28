import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updatePost, publishPost, seoSlug, wpRequest } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { faqAccordion } from '@/lib/strategy/core';

export const runtime = 'nodejs';

// Publishes an audit's rewrite. If the audit came from an existing WP post (wp_post_id set),
// 'publish' REPLACES that post in place and 'draft' makes a separate draft post, so the live post
// stays online and unchanged. Otherwise it creates a new post.
// The separate draft saved earlier is still in WordPress and not live (not trashed, deleted or published).
// Only a real 404 or 410 means it is gone: any other failure (timeout, 5xx, 401) is thrown, so the
// save fails and can be retried instead of making a second draft and losing track of the first.
async function draftStillThere(id: number): Promise<boolean> {
  const r: any = await wpRequest('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit', _fields: 'status' } }).catch((e: any) => {
    if (e?.status === 404 || e?.status === 410 || e?.code === 'rest_post_invalid_id') return null;
    throw e;
  });
  const st = r?.json?.status;
  return Boolean(st) && st !== 'trash' && st !== 'publish';
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
      // Sent as a separate draft before: that draft is updated, so no second WordPress draft is made.
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

    // The live post now carries the rewrite, so a separate draft sent earlier is moved to the trash
    // (only while it is still a draft) and forgotten. A failure here keeps its id, and the publish stands.
    let forgetDraft = {};
    if (!separateDraft && audit.wp_post_id && audit.rewrite_wp_draft_id) {
      try {
        if (await draftStillThere(audit.rewrite_wp_draft_id)) await wpRequest('DELETE', `/wp/v2/posts/${audit.rewrite_wp_draft_id}`);
        forgetDraft = { rewrite_wp_draft_id: null, rewrite_wp_draft_url: null };
      } catch (e: any) {
        console.error('Audit publish: the separate draft could not be trashed:', e?.message || e);
      }
    }

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

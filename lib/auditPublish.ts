// Check a blog / Refresh a live blog: sending an audit's rewrite to the website. Shared by
// POST /api/audit/[id]/publish and the assistant's audit_publish_live. Needs blog.publish_now
// (lib/permissions.ts for the route, the assistant's tool check for the tool).
import prisma from '@/lib/prisma';
import { updatePost, publishPost, seoSlug, postStatus, postBySlug, siteConfigured, draftsRefused, SITE_NOT_SET_UP } from '@/lib/site';
import { slugFromUrl } from '@/lib/siteConnector';
import * as activity from '@/lib/activity';
import { faqAccordion } from '@/lib/strategy/core';

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

// body: { wpStatus?: 'publish' | 'draft' }. Returns { status, body } as the route answers.
export async function publishAudit(nid: number, body: any, actor: string): Promise<{ status: number; body: any }> {
  const audit: any = await prisma.blog_audits.findUnique({ where: { id: nid } });
  if (!audit) return { status: 404, body: { error: 'Audit not found' } };
  if (!audit.rewrite_content_html) {
    return { status: 400, body: { error: 'No rewrite to publish yet. Run "Rewrite" first.' } };
  }
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(audit.rewrite_content_html)) {
    return { status: 400, body: { error: 'The rewrite still has a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]). Replace or remove it before publishing.' } };
  }

  const wpStatus = (body && body.wpStatus) || 'publish';
  // Only these two: 'pending', 'private' or 'future' on a live post would take it off the website.
  if (!['publish', 'draft'].includes(wpStatus)) {
    return { status: 400, body: { error: 'wpStatus must be "publish" or "draft".' } };
  }

  // Without the website connection nothing can go out.
  if (!siteConfigured()) {
    await activity
      .log('audit.rewrite_publish_failed', { entityType: 'blog_audit', entityId: nid, details: `"${audit.rewrite_title || audit.title || ''}": ${SITE_NOT_SET_UP}`, actor: actor })
      .catch(() => {});
    return { status: 503, body: { error: SITE_NOT_SET_UP } };
  }
  const noDraft = draftsRefused(wpStatus);
  if (noDraft) return { status: 400, body: { error: noDraft } };

  // The live post this audit came from. An audit saved before the move to the custom website holds
  // an id the website does not know: the post is found again by its address.
  let livePostId: number | null = audit.wp_post_id || null;
  if (livePostId) {
    try {
      if (!(await postStatus(livePostId))) {
        const addr = audit.wp_post_url || audit.source_url;
        const same = addr ? await postBySlug(slugFromUrl(addr)) : null;
        livePostId = same?.id || null;
      }
    } catch (e: any) {
      return { status: 502, body: { error: `The website could not be read (${String(e?.message || e).slice(0, 200)}), so nothing was sent. Try again in a few minutes.` } };
    }
    if (!livePostId) {
      const msg = `The live post this audit came from (${audit.wp_post_url || audit.source_url || `#${audit.wp_post_id}`}) could not be found on the website; nothing was sent.`;
      await activity.log('audit.rewrite_publish_failed', { entityType: 'blog_audit', entityId: nid, details: `"${audit.rewrite_title || audit.title || ''}": ${msg}`, actor: actor }).catch(() => {});
      return { status: 409, body: { error: msg } };
    }
  }

  try {
    let post: any;
    // A live post must never be switched to draft: that takes it off the website.
    const separateDraft = Boolean(audit.wp_post_id) && wpStatus === 'draft';
    if (audit.wp_post_id && !separateDraft) {
      // Existing post: keep its URL (no slug change), refresh content and the meta description.
      post = await updatePost(livePostId as number, {
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
      data: separateDraft ? { rewrite_status: 'sent_as_draft', rewrite_wp_draft_url: post.link || null, rewrite_wp_draft_id: post.id ?? null } : { rewrite_status: 'published', ...forgetDraft, ...(livePostId && livePostId !== audit.wp_post_id ? { wp_post_id: livePostId } : {}) },
    });

    await activity.log('audit.rewrite_published', {
      entityType: 'blog_audit',
      entityId: nid,
      details: `"${audit.rewrite_title}" → ${post.link} (${wpStatus}, ${separateDraft ? 'separate draft, live post unchanged' : audit.wp_post_id ? 'replaced existing' : 'new post'})`,
      actor: actor,
    });

    if (separateDraft) return { status: 200, body: { ok: true, draft: { link: post.link } } };
    return { status: 200, body: { ok: true, wpPostUrl: post.link } };
  } catch (err: any) {
    console.error(err);
    await activity
      .log('audit.rewrite_publish_failed', { entityType: 'blog_audit', entityId: nid, details: `"${audit.rewrite_title || audit.title || ''}": ${String(err.message || err).slice(0, 300)}`, actor: actor })
      .catch(() => {});
    return { status: 500, body: { error: err.message } };
  }
}

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensurePhotoCover } from '@/lib/coverPhoto';
import { uploadMedia, publishPost, updatePost, seoSlug, freeSlug } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { aiLeftovers, needsExpertReview, faqSchema, faqAccordion } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';
import { withByline, expertSchema } from '@/lib/byline';
import { authorNames, pickAuthor, wpAuthorId } from '@/lib/authors';
import { publishDraftImages } from '@/lib/inlineMedia';
import { makeCover, coverAlt } from '@/lib/cover';
import { saveFile } from '@/lib/storage';
import { ensureOriginality, originalityReason } from '@/lib/originality';

export const runtime = 'nodejs';

// 'publish', 'draft', 'trash'..., or null when the post is gone.
async function wpPostStatus(id: number): Promise<string | null> {
  const { wpRequest } = await import('@/lib/wordpress');
  const r: any = await wpRequest('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit', _fields: 'status' } }).catch(() => null);
  const st = r?.json?.status || null;
  return st === 'trash' ? null : st;
}

// What WordPress holds now: live or not, the address, and whether the FAQ is in the box format.
async function checkPost(id: number, wantSlug: string, hasFaq: boolean) {
  const { wpRequest } = await import('@/lib/wordpress');
  const r: any = await wpRequest('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit', _fields: 'status,link,slug,content' } }).catch(() => null);
  if (!r?.json) return null;
  const p = r.json;
  const raw = String(p.content?.raw || p.content?.rendered || '');
  return {
    live: p.status === 'publish',
    status: p.status,
    link: p.link,
    slugOk: p.slug === wantSlug,
    slug: p.slug,
    wantSlug,
    faqBoxes: hasFaq ? /uic-faq-accordion/.test(raw) : null,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const draft: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  // A blog sent to WordPress earlier as a draft (not live) can be sent again: the same post is
  // updated, so no second copy is made.
  const wpLive = draft.wp_post_id ? await wpPostStatus(draft.wp_post_id) : null;
  // A live blog can be sent again too: that updates the same live post (for example after an edit).
  if (draft.status !== 'approved' && !(draft.status === 'published' && draft.wp_post_id)) {
    return NextResponse.json({ error: 'Draft must be approved before publishing' }, { status: 400 });
  }
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(draft.content_html || '')) {
    return NextResponse.json({ error: 'The draft still has a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]). Replace or remove it before publishing.' }, { status: 400 });
  }

  const orig = await ensureOriginality(nid).catch(() => null);
  if (orig && !orig.ok) return NextResponse.json({ error: originalityReason(orig) }, { status: 400 });

  const leftovers = aiLeftovers(draft.title, draft.meta_description, draft.content_html);
  if (leftovers.length) return NextResponse.json({ error: `Remove the AI notes first. ${leftovers.join(' ')}` }, { status: 400 });

  const body: any = await req.json().catch(() => ({}));
  const wpStatus = wpLive === 'publish' ? 'publish' : (body && body.wpStatus) || 'publish'; // 'publish' (live) or 'draft'
  const reviewer = String(body?.reviewer || '').trim();
  const kw = (await prisma.keywords.findUnique({ where: { id: draft.keyword_id }, select: { keyword: true } }))?.keyword;
  if (wpStatus === 'publish' && (await requireExpert()) && needsExpertReview(kw, draft.title)) {
    const known = await expertReviewers();
    if (!reviewer || (!known.includes(reviewer) && !CREDENTIAL.test(reviewer))) {
      return NextResponse.json({ error: 'This is a tax, legal or compliance blog. Name the CA/CPA who reviewed it before it goes live.', reviewers: known }, { status: 400 });
    }
  }

  try {
    const keyword = kw;
    const author = draft.author || pickAuthor(await authorNames());
    if (!draft.author) await prisma.drafts.update({ where: { id: nid }, data: { author } });
    const authorId = await wpAuthorId(author).catch(() => null);

    // The cover: the uploaded one, or the branded cover made from the title and author (the same
    // one the preview and the Word file show).
    let imageKey = draft.featured_image_path || (await ensurePhotoCover(nid).catch(() => null));
    if (!imageKey) {
      imageKey = await saveFile(`covers/${Date.now()}-${seoSlug(keyword || draft.title)}.png`, await makeCover(draft.title, author), 'image/png').catch(() => null);
      if (imageKey) await prisma.drafts.update({ where: { id: nid }, data: { featured_image_path: imageKey } });
    }
    // It goes to the Media Library with its alt text (what the picture shows), so Google reads it.
    const cover = imageKey ? await uploadMedia(imageKey, { altText: coverAlt(draft), title: draft.title }) : null;

    // Images a person placed in the article move to the WordPress Media Library first.
    const inline = await publishDraftImages(nid, draft.content_html || '');
    const contentHtml = `${withByline(faqAccordion(inline.html), author, reviewer || null)}\n${faqSchema(draft.content_html) || ''}\n${expertSchema({ title: draft.title, author, reviewer: reviewer || null, image: cover?.url || null }) || ''}`;
    const fields = {
      title: draft.title,
      contentHtml,
      author: authorId || undefined,
      authorName: author,
      excerpt: draft.meta_description,
      featuredMediaId: cover?.id,
      status: wpStatus,
      slug: seoSlug(keyword || draft.title),
      metaDescription: draft.meta_description,
      focusKeyphrase: keyword,
    };
    // The planned address must be free: a copy that was never live is moved to the trash.
    const freed = wpStatus === 'publish' ? await freeSlug(fields.slug, draft.wp_post_id).catch(() => null) : null;
    if (freed?.trashed.length) await activity.log('wordpress.duplicate_trashed', { entityType: 'draft', entityId: nid, details: `"${draft.title}": moved WordPress post(s) ${freed.trashed.map((x) => `#${x}`).join(', ')} (never live) to the trash to free /${fields.slug}/`, actor: await getActor() });
    // Already on WordPress (as a draft): update that post instead of making another one.
    const post: any = draft.wp_post_id && wpLive ? await updatePost(draft.wp_post_id, fields) : await publishPost(fields);
    const yoastSaved = Boolean(post.meta && post.meta._yoast_wpseo_metadesc);

    await prisma.drafts.update({
      where: { id: nid },
      // Live: published, with its address. A WordPress draft is not on the website: the blog stays
      // approved (so it can be published live later), with the post id kept to update that post.
      data: wpStatus === 'publish' ? { status: 'published', wp_post_id: post.id, wp_post_url: post.link, updated_at: sqlNow() } : { status: 'approved', wp_post_id: post.id, wp_post_url: null, updated_at: sqlNow() },
    });
    // A calendar blog published here counts as published on the calendar too (it does not publish again).
    if (wpStatus === 'publish') {
      await prisma.blog_schedule.updateMany({ where: { draft_id: nid, status: { not: 'published' } }, data: { status: 'published', wp_post_url: post.link, hold_reasons: null, updated_at: sqlNow() } }).catch(() => {});
    }

    await activity.log('wordpress.published', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${draft.title}" → ${post.link} (${wpStatus === 'publish' ? 'live on the website' : 'WordPress draft, NOT live yet'})`,
      actor: await getActor(),
    });

    // Read the post back from WordPress, so the screen says what really happened.
    const check = await checkPost(post.id, fields.slug, Boolean(faqSchema(draft.content_html)));
    return NextResponse.json({ ok: true, wpPostId: post.id, wpPostUrl: check?.link || post.link, yoastSaved, check: check && { ...check, trashed: freed?.trashed || [], liveHolder: freed?.liveHolder || null } }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    await activity.log('wordpress.publish_failed', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${draft.title}": ${err.message}`,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

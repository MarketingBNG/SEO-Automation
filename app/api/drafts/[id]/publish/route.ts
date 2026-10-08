import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { uploadMedia, publishPost, seoSlug } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { aiLeftovers, needsExpertReview, faqSchema } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';
import { withByline, expertSchema } from '@/lib/byline';
import { authorNames, pickAuthor, wpAuthorId } from '@/lib/authors';
import { publishDraftImages } from '@/lib/inlineMedia';
import { makeCover, coverAlt } from '@/lib/cover';
import { saveFile } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const draft: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.status !== 'approved') {
    return NextResponse.json({ error: 'Draft must be approved before publishing' }, { status: 400 });
  }
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(draft.content_html || '')) {
    return NextResponse.json({ error: 'The draft still has a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]). Replace or remove it before publishing.' }, { status: 400 });
  }

  const leftovers = aiLeftovers(draft.title, draft.meta_description, draft.content_html);
  if (leftovers.length) return NextResponse.json({ error: `Remove the AI notes first. ${leftovers.join(' ')}` }, { status: 400 });

  const body: any = await req.json().catch(() => ({}));
  const wpStatus = (body && body.wpStatus) || 'draft'; // 'draft' or 'publish'
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
    let imageKey = draft.featured_image_path;
    if (!imageKey) {
      imageKey = await saveFile(`covers/${Date.now()}-${seoSlug(keyword || draft.title)}.png`, await makeCover(draft.title, author), 'image/png').catch(() => null);
      if (imageKey) await prisma.drafts.update({ where: { id: nid }, data: { featured_image_path: imageKey } });
    }
    // It goes to the Media Library with its alt text (what the picture shows), so Google reads it.
    const cover = imageKey ? await uploadMedia(imageKey, { altText: coverAlt(draft), title: draft.title }) : null;

    // Images a person placed in the article move to the WordPress Media Library first.
    const inline = await publishDraftImages(nid, draft.content_html || '');
    const contentHtml = `${withByline(inline.html, author, reviewer || null)}\n${faqSchema(draft.content_html) || ''}\n${expertSchema({ title: draft.title, author, reviewer: reviewer || null, image: cover?.url || null }) || ''}`;
    const post: any = await publishPost({
      title: draft.title,
      contentHtml,
      author: authorId || undefined,
      excerpt: draft.meta_description,
      featuredMediaId: cover?.id,
      status: wpStatus,
      slug: seoSlug(keyword || draft.title),
      metaDescription: draft.meta_description,
      focusKeyphrase: keyword,
    });
    const yoastSaved = Boolean(post.meta && post.meta._yoast_wpseo_metadesc);

    await prisma.drafts.update({
      where: { id: nid },
      data: { status: 'published', wp_post_id: post.id, wp_post_url: post.link, updated_at: sqlNow() },
    });

    await activity.log('wordpress.published', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${draft.title}" → ${post.link} (${wpStatus})`,
      actor: await getActor(),
    });

    return NextResponse.json({ ok: true, wpPostId: post.id, wpPostUrl: post.link, yoastSaved }, { status: 200 });
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

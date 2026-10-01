import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { uploadFeaturedImage, publishPost, seoSlug } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

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

  const body: any = await req.json().catch(() => ({}));
  const wpStatus = (body && body.wpStatus) || 'draft'; // 'draft' or 'publish'

  try {
    let featuredMediaId;
    if (draft.featured_image_path) {
      featuredMediaId = await uploadFeaturedImage(draft.featured_image_path);
    }

    const keyword = (await prisma.keywords.findUnique({ where: { id: draft.keyword_id }, select: { keyword: true } }))?.keyword;
    const post: any = await publishPost({
      title: draft.title,
      contentHtml: draft.content_html,
      excerpt: draft.meta_description,
      featuredMediaId,
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

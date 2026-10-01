import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updatePost, publishPost, seoSlug } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Publishes an audit's rewrite. If the audit came from an existing WP post (wp_post_id set),
// this REPLACES that post in place. Otherwise it creates a new post.
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
  const wpStatus = (body && body.wpStatus) || 'draft';

  try {
    let post: any;
    if (audit.wp_post_id) {
      // Existing post: keep its URL (no slug change), refresh content and the meta description.
      post = await updatePost(audit.wp_post_id, {
        title: audit.rewrite_title,
        contentHtml: audit.rewrite_content_html,
        excerpt: audit.rewrite_meta || undefined,
        status: wpStatus,
        metaDescription: audit.rewrite_meta,
      } as any);
    } else {
      post = await publishPost({
        title: audit.rewrite_title,
        contentHtml: audit.rewrite_content_html,
        excerpt: audit.rewrite_meta || '',
        status: wpStatus,
        slug: seoSlug(audit.rewrite_title),
        metaDescription: audit.rewrite_meta,
      } as any);
    }

    await prisma.blog_audits.update({ where: { id: nid }, data: { rewrite_status: 'published' } });

    await activity.log('audit.rewrite_published', {
      entityType: 'blog_audit',
      entityId: Number(id),
      details: `"${audit.rewrite_title}" → ${post.link} (${wpStatus}, ${audit.wp_post_id ? 'replaced existing' : 'new post'})`,
      actor: await getActor(),
    });

    return NextResponse.json({ ok: true, wpPostUrl: post.link }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

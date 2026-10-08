import { NextRequest, NextResponse } from 'next/server';
import { listPosts } from '@/lib/wordpress';
import prisma from '@/lib/prisma';
import { getMe } from '@/lib/auth';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const page = parseInt(req.nextUrl.searchParams.get('page') as any, 10) || 1;
    const { posts, totalPages }: any = await listPosts({ perPage: 20, page });

    const audits = await prisma.blog_audits.findMany({
      where: { wp_post_id: { not: null } },
      select: { wp_post_id: true, id: true, verdict: true, rewrite_status: true, audit_status: true, audit_error: true },
      orderBy: { id: 'desc' },
    });
    const latestAuditByPost: Record<string, any> = {};
    for (const a of audits as any[]) {
      if (!latestAuditByPost[a.wp_post_id]) latestAuditByPost[a.wp_post_id] = a;
    }
    // Where each live post came from: written by this dashboard, rewritten here from an older
    // post, or on the site before the dashboard (and not touched by it).
    const fromDashboard = new Set((await prisma.drafts.findMany({ where: { wp_post_id: { not: null } }, select: { wp_post_id: true } })).map((d) => d.wp_post_id));
    const rewrittenHere = new Set((audits as any[]).filter((a) => a.rewrite_status === 'published').map((a) => a.wp_post_id));

    const me = await getMe();
    const admin = me?.role === 'admin' || me?.role === 'tester';
    const merged = posts.map((p: any) => ({
      id: p.id,
      title: p.title?.rendered || '(untitled)',
      link: p.link,
      modified: p.modified,
      audit: latestAuditByPost[p.id] || null,
      // Shown to the admin (and those with admin rights) only.
      origin: !admin ? null : fromDashboard.has(p.id) ? 'dashboard' : rewrittenHere.has(p.id) ? 'rewritten' : 'old',
    }));

    return NextResponse.json({ posts: merged, totalPages, page }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

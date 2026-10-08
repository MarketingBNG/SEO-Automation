import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';
import { getMe } from '@/lib/auth';

// Where a draft came from, from the batch its keyword was queued in.
function sourceOf(batch: string | null, kind: string) {
  if (kind === 'article') return 'LinkedIn article from the Topics page';
  if (String(batch || '').startsWith('Strategy #')) return 'Monthly Strategy blog calendar';
  if (batch === 'Topics') return 'Topics page';
  return 'Write a blog page (keyword list)';
}

export const runtime = 'nodejs';

// Was: SELECT drafts.*, keywords.keyword AS keyword, keywords.batch_name AS batch_name
//      FROM drafts JOIN keywords ON keywords.id = drafts.keyword_id ORDER BY drafts.id DESC
export async function GET() {
  // Light rows: the list never shows the article; the editor loads the full draft by id.
  const rows = await prisma.drafts.findMany({
    select: { id: true, keyword_id: true, title: true, status: true, production_state: true, repair_attempts: true, word_count: true, created_at: true, updated_at: true, wp_post_url: true, wp_post_id: true, author: true, featured_image_path: true, kind: true, keyword: { select: { keyword: true, batch_name: true } } },
    orderBy: { id: 'desc' },
    take: 500,
  });
  // Origin and history are for the admin (and those with admin rights) only.
  const me = await getMe();
  const admin = me?.role === 'admin' || me?.role === 'tester';
  const sched = admin ? await prisma.blog_schedule.findMany({ where: { draft_id: { in: rows.map((r) => r.id) } }, select: { draft_id: true, revisions: true, status: true, reviewed_by: true, rejected_by: true } }) : [];
  const byDraft = new Map(sched.map((s) => [s.draft_id, s]));
  return NextResponse.json(
    rows.map(({ keyword, ...d }: any) => {
      const base = { ...d, keyword: keyword?.keyword ?? null, batch_name: keyword?.batch_name ?? null };
      if (!admin) return base;
      const s = byDraft.get(d.id);
      return {
        ...base,
        origin: {
          createdBy: 'dashboard',
          source: sourceOf(keyword?.batch_name ?? null, d.kind),
          created: d.created_at,
          rewrites: s?.revisions || 0,
          reviewedBy: s?.reviewed_by || null,
          rejectedBy: s?.rejected_by || null,
          onWebsite: d.wp_post_url || null,
          autoRepairs: d.repair_attempts || 0,
        },
      };
    }),
    { status: 200 }
  );
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

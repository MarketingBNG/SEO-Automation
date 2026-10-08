import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';
import { getMe } from '@/lib/auth';
import { publishPlan } from '@/lib/strategy/core';

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
  const ids = rows.map((r) => r.id);
  const sched = admin ? await prisma.blog_schedule.findMany({ where: { draft_id: { in: ids } } }) : [];
  const byDraft = new Map(sched.map((s) => [s.draft_id, s]));
  // When each published draft actually went to the website (from the activity log).
  const pubLog = admin ? await prisma.activity_log.findMany({ where: { action: { in: ['wordpress.published', 'schedule.published'] }, entity_type: 'draft', entity_id: { in: ids } }, select: { entity_id: true, created_at: true }, orderBy: { id: 'asc' } }) : [];
  const publishedAt = new Map(pubLog.map((l) => [l.entity_id, l.created_at]));
  const ist = (s: string) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';
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
          created: ist(d.created_at),
          rewrites: s?.revisions || 0,
          reviewedBy: s?.reviewed_by || null,
          rejectedBy: s?.rejected_by || null,
          onWebsite: d.wp_post_url || null,
          // The website date: when it went up, or when it is due to go up.
          websiteDate: d.wp_post_url
            ? publishedAt.get(d.id) || s?.status === 'published'
              ? `Published on the website ${ist(publishedAt.get(d.id) || s!.updated_at)}.`
              : 'Published on the website (date not recorded).'
            : s
              ? `Website date: ${publishPlan(s, new Date()).headline}. ${publishPlan(s, new Date()).detail}`
              : d.status === 'approved'
                ? 'Website date: not scheduled. It goes up only when someone presses Publish in Drafts & Review.'
                : 'Website date: not scheduled. Approve it, then press Publish in Drafts & Review.',
          autoRepairs: d.repair_attempts || 0,
        },
      };
    }),
    { status: 200 }
  );
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

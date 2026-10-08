import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseAuditRow } from '@/lib/audits';
import { startAudit, markLostJobs } from '@/lib/auditJobs';
import { getActor, getMe } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Polled by the page while an audit or rewrite runs.
export async function GET() {
  await markLostJobs().catch(() => {});
  const rows = await prisma.blog_audits.findMany({ orderBy: { id: 'desc' }, take: 300 });
  const me = await getMe();
  const admin = me?.role === 'admin' || me?.role === 'tester';
  if (!admin) return NextResponse.json(rows.map((r: any) => parseAuditRow(r)), { status: 200 });
  // Where the audited blog came from: a live post the dashboard wrote, an older live post, a link,
  // or a file or text uploaded on the dashboard.
  const dashboardPosts = new Set((await prisma.drafts.findMany({ where: { wp_post_id: { not: null } }, select: { wp_post_id: true } })).map((d) => d.wp_post_id));
  const origin = (r: any) =>
    r.wp_post_id
      ? dashboardPosts.has(r.wp_post_id)
        ? { label: 'Created by dashboard', detail: 'A live post that the dashboard wrote and published, audited here.' }
        : { label: 'Old', detail: 'A post that was on the website before the dashboard, audited here.' }
      : r.source_url
        ? { label: 'From a link', detail: `Fetched from ${r.source_url} and audited here.` }
        : { label: 'New upload', detail: 'A Word file or text uploaded on the dashboard (Check a blog, Topics or the Assistant), not taken from the website.' };
  return NextResponse.json(rows.map((r: any) => ({ ...parseAuditRow(r), origin: origin(r) })), { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const { title, contentHtml, sourceUrl, wpPostId }: any = (await req.json().catch(() => ({}))) || {};
    // Returns at once with the row in state "running"; the page polls GET for the result.
    const audit = await startAudit({ title, contentHtml, sourceUrl, wpPostId, actor: await getActor() });
    return NextResponse.json(audit, { status: 202 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

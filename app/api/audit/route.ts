import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseAuditRow } from '@/lib/audits';
import { startAudit, markLostJobs } from '@/lib/auditJobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Polled by the page while an audit or rewrite runs.
export async function GET() {
  await markLostJobs().catch(() => {});
  const rows = await prisma.blog_audits.findMany({ orderBy: { id: 'desc' }, take: 300 });
  return NextResponse.json(rows.map((r: any) => parseAuditRow(r)), { status: 200 });
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

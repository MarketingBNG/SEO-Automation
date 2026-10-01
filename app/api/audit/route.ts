import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAudit, parseAuditRow } from '@/lib/audits';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await prisma.blog_audits.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows.map((r: any) => parseAuditRow(r)), { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const { title, contentHtml, sourceUrl, wpPostId }: any = (await req.json().catch(() => ({}))) || {};
    const audit = await createAudit({ title, contentHtml, sourceUrl, wpPostId });
    return NextResponse.json(audit, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

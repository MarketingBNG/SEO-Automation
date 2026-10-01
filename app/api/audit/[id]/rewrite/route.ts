import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { rewriteBlog } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { parseAuditRow } from '@/lib/audits';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const audit: any = await prisma.blog_audits.findUnique({ where: { id: nid } });
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });

  const contentSource = audit.content_html || null;
  if (!contentSource) {
    return NextResponse.json(
      {
        error: 'This audit was run from a URL without saving content, so there is nothing to rewrite from directly. Re-run the audit with pasted content or a file upload.',
      },
      { status: 400 }
    );
  }

  await prisma.blog_audits.update({ where: { id: nid }, data: { rewrite_status: 'generating' } });

  try {
    const issues = JSON.parse(audit.issues || '[]');
    const suggestions = JSON.parse(audit.suggestions || '[]');

    const result: any = await rewriteBlog({
      title: audit.title,
      content: contentSource,
      issues,
      suggestions,
    });

    await prisma.blog_audits.update({
      where: { id: nid },
      data: {
        rewrite_title: result.title,
        rewrite_content_html: result.content,
        rewrite_meta: result.meta || null,
        rewrite_people_also_ask: JSON.stringify(result.peopleAlsoAsk || []),
        rewrite_status: 'ready',
      },
    });

    await activity.log('audit.rewritten', {
      entityType: 'blog_audit',
      entityId: Number(id),
      details: `"${result.title}", ${result.productionState}, ${result.repairAttempts} repair attempt(s)`,
    });

    return NextResponse.json(parseAuditRow(await prisma.blog_audits.findUnique({ where: { id: nid } })), { status: 200 });
  } catch (err: any) {
    await prisma.blog_audits.update({ where: { id: nid }, data: { rewrite_status: null } });
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

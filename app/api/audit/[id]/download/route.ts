import { NextRequest, NextResponse } from 'next/server';
import HTMLtoDOCX from 'html-to-docx';
import prisma from '@/lib/prisma';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Exports the approved rewrite as a .docx so it can be printed and hand-edited - the rewrite
// itself stays untouched in the database either way.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audit: any = await prisma.blog_audits.findUnique({ where: { id: toId(id) } });
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  if (!audit.rewrite_content_html) {
    return NextResponse.json({ error: 'No rewrite to export yet for this audit' }, { status: 400 });
  }

  const issues = JSON.parse(audit.issues || '[]');
  const suggestions = JSON.parse(audit.suggestions || '[]');

  const changesHtml = `
    <h2>What changed &amp; why</h2>
    ${issues.length ? `<ul>${issues.map((i: any) => `<li><b>[${i.severity}/${i.category}]</b> ${escapeHtml(i.description)}</li>`).join('')}</ul>` : ''}
    ${suggestions.length ? `<p><b>Fixes applied:</b></p><ul>${suggestions.map((s: any) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
    <hr/>
  `;

  const html = `
    <h1>${escapeHtml(audit.rewrite_title || audit.title || 'Untitled')}</h1>
    ${changesHtml}
    ${audit.rewrite_content_html}
  `;

  const buffer: any = await (HTMLtoDOCX as any)(html, null, {
    title: audit.rewrite_title || audit.title || 'Blog rewrite',
    margins: { top: 720, bottom: 720, left: 720, right: 720 },
  });

  const filename = (audit.rewrite_title || 'blog-rewrite')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'blog-rewrite';

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}.docx"`,
    },
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

function escapeHtml(str: any) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

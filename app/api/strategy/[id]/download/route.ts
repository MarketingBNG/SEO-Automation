import { NextRequest, NextResponse } from 'next/server';
import HTMLtoDOCX from 'html-to-docx';
import prisma from '@/lib/prisma';
import { parseStrategyRow } from '@/lib/strategyPlanner';
import { renderReportHtml } from '@/lib/strategyReport';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// The monthly strategy and report as a Word document, for sharing and printing.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.seo_strategies.findUnique({ where: { id: toId(id) } });
  if (!row) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });

  const strategy: any = parseStrategyRow(row);
  const buffer: any = await (HTMLtoDOCX as any)(await renderReportHtml(strategy), null, {
    title: `SEO strategy ${strategy.period}`,
    margins: { top: 720, bottom: 720, left: 720, right: 720 },
    orientation: 'landscape',
  });
  const filename = `seo-strategy-${String(strategy.period).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}.docx"`,
    },
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

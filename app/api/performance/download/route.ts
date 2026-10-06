import { NextRequest, NextResponse } from 'next/server';
import { htmlToDocx } from '@/lib/docx';
import { cachedPerformance } from '@/lib/performanceReport';
import { renderPerformanceHtml } from '@/lib/performanceDoc';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/performance/download?days=28: the whole report as a Word file, graphs included.
export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(7, parseInt(req.nextUrl.searchParams.get('days') as any, 10) || 28));
  try {
    const perf: any = await cachedPerformance(days);
    const buffer: any = await htmlToDocx(await renderPerformanceHtml(perf), {
      title: 'SEO, AEO and GEO performance',
      margins: { top: 720, bottom: 720, left: 720, right: 720 },
    });
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="seo-aeo-geo-report-${perf.ranges.current.endDate}.docx"`,
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

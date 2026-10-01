import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseScreamingFrogCsv } from '@/lib/technicalAudit';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // Parse straight from memory; no temp file needed.
    const buf = Buffer.from(await file.arrayBuffer());
    const result: any = parseScreamingFrogCsv(buf);

    const created = await prisma.technical_crawls.create({
      data: {
        filename: file.name || 'crawl.csv',
        total_urls: result.totalUrls,
        broken_count: result.brokenCount,
        missing_title_count: result.missingTitleCount,
        duplicate_title_count: result.duplicateTitleCount,
        missing_meta_count: result.missingMetaCount,
        thin_content_count: result.thinContentCount,
        problem_urls: JSON.stringify(result.problemUrls),
      },
    });

    await activity.log('technical.imported', {
      entityType: 'technical_crawl',
      entityId: created.id,
      details: `${result.totalUrls} URLs, ${result.brokenCount} broken, ${result.duplicateTitleCount} duplicate titles`,
      actor: await getActor(),
    });

    const row: any = await prisma.technical_crawls.findUnique({ where: { id: created.id } });
    return NextResponse.json({ ...row, problem_urls: JSON.parse(row.problem_urls || '[]') }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

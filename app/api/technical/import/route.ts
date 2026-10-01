import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

    // PORT NOTE: lib/technicalAudit's parseScreamingFrogCsv reads from a file path (as formidable
    // provided). The upload is written to the OS temp dir (writable on Vercel) and removed after.
    const buf = Buffer.from(await file.arrayBuffer());
    const tmp = path.join(os.tmpdir(), `sf-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.name || '')}`);
    fs.writeFileSync(tmp, buf);
    let result: any;
    try {
      result = await parseScreamingFrogCsv(tmp);
    } finally {
      fs.unlink(tmp, () => {});
    }

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

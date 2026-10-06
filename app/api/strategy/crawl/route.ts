import { NextRequest, NextResponse } from 'next/server';
import { uploadCrawl, latestCrawl } from '@/lib/strategy/service';
import { crawlIsFresh } from '@/lib/strategy/core';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  const c = await latestCrawl();
  return NextResponse.json(c ? { id: c.id, filename: c.filename, uploadedAt: c.created_at, uploadedBy: c.uploaded_by, fresh: crawlIsFresh(c.created_at) } : null);
}

// Screaming Frog upload (CSV or XLSX, form field "file"). Rebuilds Section 8 of open strategies.
export async function POST(req: NextRequest) {
  try {
    const file = (await req.formData()).get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const c = await uploadCrawl(file as File, await getActor());
    return NextResponse.json({ id: c.id, uploadedAt: c.created_at, uploadedBy: c.uploaded_by, linksCount: c.links_count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { keyMatches, normalizeSlug, toPage } from '@/lib/siteContent';

export const runtime = 'nodejs';

// Public website API (read key): one published page. "home" is the home page "/".
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  const slug = normalizeSlug((await params).slug.join('/'));
  const row = await prisma.site_content.findFirst({ where: { slug, type: 'page', status: 'published' } });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(toPage(row));
}

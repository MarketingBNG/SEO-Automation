import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { keyMatches } from '@/lib/siteContent';
import { siteRead } from '@/lib/siteApiCache';

export const runtime = 'nodejs';

// Public website API (read key): all published pages.
export async function GET(req: NextRequest) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  return siteRead(req, async () => {
    const rows = await prisma.site_content.findMany({ where: { type: 'page', status: 'published' }, orderBy: { slug: 'asc' }, select: { slug: true, title: true, updated_at: true } });
    return { status: 200, body: rows.map((r) => ({ slug: r.slug, title: r.title, updatedAt: r.updated_at })) };
  });
}

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { keyMatches } from '@/lib/siteContent';

export const runtime = 'nodejs';

// Public website API (read key): all published pages.
export async function GET(req: NextRequest) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  const rows = await prisma.site_content.findMany({ where: { type: 'page', status: 'published' }, orderBy: { slug: 'asc' }, select: { slug: true, title: true, updated_at: true } });
  return NextResponse.json(rows.map((r) => ({ slug: r.slug, title: r.title, updatedAt: r.updated_at })));
}

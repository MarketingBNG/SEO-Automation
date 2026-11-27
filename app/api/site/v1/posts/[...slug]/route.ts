import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { keyMatches, normalizeSlug, toPost } from '@/lib/siteContent';
import { siteRead } from '@/lib/siteApiCache';

export const runtime = 'nodejs';

// Public website API (read key): one published post, by its full path or by the part after /blog/.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  const slug = normalizeSlug((await params).slug.join('/'));
  return siteRead(req, async () => {
    const row = await prisma.site_content.findFirst({ where: { slug: { in: [slug, `/blog${slug}`] }, type: 'post', status: 'published' } });
    return row ? { status: 200, body: toPost(row) } : { status: 404, body: { error: 'Not found' } };
  });
}

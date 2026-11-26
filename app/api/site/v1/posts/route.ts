import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { keyMatches, toPost } from '@/lib/siteContent';
import { siteRead } from '@/lib/siteApiCache';

export const runtime = 'nodejs';

// Public website API (read key): published posts, newest first. ?page=1&perPage=12&category=
export async function GET(req: NextRequest) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  return siteRead(req, async () => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const perPage = Math.min(100, Math.max(1, Number(sp.get('perPage')) || 12));
  const category = sp.get('category');
  const where: any = { type: 'post', status: 'published', ...(category ? { categories: { contains: JSON.stringify(category) } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.site_content.count({ where }),
    prisma.site_content.findMany({ where, orderBy: [{ published_at: 'desc' }, { id: 'desc' }], skip: (page - 1) * perPage, take: perPage }),
  ]);
  return { status: 200, body: { items: rows.map((r) => toPost(r, false)), total, page } };
  });
}

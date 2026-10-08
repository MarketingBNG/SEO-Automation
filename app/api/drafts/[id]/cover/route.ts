import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { makeCover } from '@/lib/cover';
import { readFile, mimeFor } from '@/lib/storage';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// GET /api/drafts/[id]/cover: the featured image the post will carry: the uploaded one, or the
// branded cover the dashboard makes from the title and author.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const draft: any = await prisma.drafts.findUnique({ where: { id }, include: { keyword: { select: { keyword: true } } } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.featured_image_path) {
    const buf = await readFile(draft.featured_image_path);
    if (buf) return new Response(new Uint8Array(buf), { headers: { 'Content-Type': mimeFor(draft.featured_image_path), 'Cache-Control': 'private, max-age=60' } });
  }
  const row = await prisma.blog_schedule.findFirst({ where: { draft_id: id }, select: { author: true } });
  const png = await makeCover(draft.title || draft.keyword?.keyword || 'Untitled', row?.author || draft.author || null);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' } });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

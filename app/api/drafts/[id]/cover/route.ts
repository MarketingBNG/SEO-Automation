import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { makeCover } from '@/lib/cover';
import { readFile, mimeFor } from '@/lib/storage';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

const g = globalThis as unknown as { __coverCache?: Map<string, Buffer> };
const covers = (g.__coverCache ||= new Map<string, Buffer>());

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
  const title = draft.title || draft.keyword?.keyword || 'Untitled';
  const author = row?.author || draft.author || null;
  // The branded cover is drawn once per title and author; lists show many at a time.
  const key = `${title}|${author || ''}`;
  let png = covers.get(key);
  if (!png) {
    png = await makeCover(title, author);
    covers.set(key, png);
    if (covers.size > 100) covers.delete(covers.keys().next().value as string);
  }
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' } });
}
// POST: make a new photo cover for this blog (a different real photo, or an AI photo when none fits),
// replacing the current cover. Used by "New photo cover" in Drafts & Review.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const draft = await prisma.drafts.findUnique({ where: { id }, select: { id: true, featured_image_path: true, wp_post_url: true } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  const { ensurePhotoCover } = await import('@/lib/coverPhoto');
  await prisma.drafts.update({ where: { id }, data: { featured_image_path: null } });
  const key = await ensurePhotoCover(id).catch(() => null);
  if (!key) {
    await prisma.drafts.update({ where: { id }, data: { featured_image_path: draft.featured_image_path } });
    return NextResponse.json({ error: 'No photo cover could be made. Add PEXELS_API_KEY (free) or OPENAI_API_KEY in Coolify.' }, { status: 400 });
  }
  await prisma.drafts.update({ where: { id }, data: { updated_at: sqlNow() } });
  return NextResponse.json({ ok: true, key });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

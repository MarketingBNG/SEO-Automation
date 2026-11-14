import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { makeCover } from '@/lib/cover';
import { readFile, mimeFor } from '@/lib/storage';
import { sqlNow } from '@/lib/time';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { newPhotoCover } from '@/lib/draftActions';

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
// POST, three uses:
//  { action: 'preview', main?, cutout?, variant? }: make a banner to look at (Make banner / Try another
//    design). Saved as a candidate, NOT as the cover: { key, url, source }. May spend a small AI call
//    (art direction) and an image; the AI parts are skipped in Testing mode and while AI work is paused.
//  { action: 'use', key }: the person picked that banner; it becomes the cover the post carries.
//  no body: make a new photo cover and use it right away ("New photo cover", as before).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const body: any = await req.json().catch(() => ({}));
  const draft = await prisma.drafts.findUnique({ where: { id }, select: { id: true, title: true, author: true, featured_image_path: true, wp_post_url: true, keyword: { select: { keyword: true } } } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  const { bannerCandidate, checkCandidate } = await import('@/lib/coverPhoto');
  if (body?.action === 'preview') {
    const row = await prisma.blog_schedule.findFirst({ where: { draft_id: id }, select: { author: true } });
    const title = draft.title || draft.keyword?.keyword || 'Untitled';
    try {
      const c = await bannerCandidate({ title, topic: `${title} ${draft.keyword?.keyword || ''}`.trim(), author: row?.author || draft.author || null, main: body.main, cutout: body.cutout, variant: body.variant, draftId: id }, id);
      return NextResponse.json({ ok: true, key: c.key, url: `/api/uploads/${c.key}`, source: c.source });
    } catch (e: any) {
      return NextResponse.json({ error: `The banner could not be made: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 });
    }
  }
  if (body?.action === 'use') {
    const key = await checkCandidate(body.key);
    if (!key) return NextResponse.json({ error: 'That banner was not found. Make it again.' }, { status: 400 });
    await prisma.drafts.update({ where: { id }, data: { featured_image_path: key, updated_at: sqlNow() } });
    await activity.log('draft.creative_uploaded', { entityType: 'draft', entityId: id, details: `"${draft.title}" (banner chosen from the preview)`, actor: await getActor() });
    return NextResponse.json({ ok: true, key });
  }
  // "New photo cover" (shared with the assistant's draft_new_cover, lib/draftActions.ts).
  const r = await newPhotoCover(id);
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

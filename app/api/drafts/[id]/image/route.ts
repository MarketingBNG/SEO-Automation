import { NextRequest, NextResponse } from 'next/server';
import sharp, { type Metadata } from 'sharp';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { saveFile, deleteFile } from '@/lib/storage';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { png: '.png', jpeg: '.jpg', jpg: '.jpg', webp: '.webp', gif: '.gif' };

// POST (multipart): image + alt? replaces the cover (featured image). The alt text says what the
// picture shows; it goes to WordPress with the image. Empty keeps the alt text already saved.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const draft: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No image uploaded' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The image must be under 8 MB.' }, { status: 400 });
    const alt = String(form.get('alt') || '').trim().slice(0, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    let meta: Metadata | null = null;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      meta = null;
    }
    const ext = meta?.format ? EXT[meta.format] : undefined;
    if (!ext) return NextResponse.json({ error: 'Only PNG, JPG, WebP or GIF images can be the cover.' }, { status: 400 });

    // Same name formidable produced before: draft-<id>-<timestamp><extension>.
    const key = `draft-${id}-${Date.now()}${ext}`;
    await saveFile(key, bytes);

    // Remove old creative if one existed
    if (draft.featured_image_path) {
      await deleteFile(draft.featured_image_path).catch(() => {});
    }

    await prisma.drafts.update({ where: { id: nid }, data: { featured_image_path: key, cover_alt: alt || draft.cover_alt || null, updated_at: sqlNow() } });

    await activity.log('draft.creative_uploaded', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${draft.title}"${alt ? ` (alt text: ${alt.slice(0, 80)})` : ''}`,
      actor: await getActor(),
    });

    return NextResponse.json({ ok: true, path: key }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

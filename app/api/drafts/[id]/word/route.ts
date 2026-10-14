import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import mammoth from 'mammoth';
import prisma from '@/lib/prisma';
import { readFile, saveFile, deleteFile } from '@/lib/storage';
import { makeCover } from '@/lib/cover';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { inlineImageKeys, UPLOAD_PREFIX } from '@/lib/blogImages';
import { blogFromWordHtml, dataImages } from '@/lib/wordImport';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' };

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const escAttr = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const plain = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// POST (multipart, file = .docx): reads a Word file, usually one downloaded here and edited, and
// returns the blog it holds: { title, meta_description, content_html, notes }. Nothing is saved:
// the editor shows it, and the person saves it like any other edit. The one exception is the cover:
// a different picture above the title line replaces the cover right away (reported in notes). Pictures that were already in
// the blog keep their stored file and alt text; new ones are stored like an uploaded image.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const draft: any = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No Word file uploaded.' }, { status: 400 });
  if (!/\.docx$/i.test(file.name || '')) return NextResponse.json({ error: 'Upload a Word file (.docx). An old .doc file: open it in Word and use Save As > Word Document (.docx).' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The Word file must be under 25 MB.' }, { status: 400 });

  let html = '';
  try {
    html = (await mammoth.convertToHtml({ buffer: Buffer.from(await file.arrayBuffer()) })).value;
  } catch {
    return NextResponse.json({ error: 'That file could not be read as a Word document.' }, { status: 400 });
  }
  const blog = blogFromWordHtml(html);
  if (plain(blog.content).length < 200) {
    return NextResponse.json({ error: 'The Word file has almost no article text, so the blog was not replaced. Check that you uploaded the right file.' }, { status: 400 });
  }

  // The blog's current pictures, by their bytes: the same picture coming back keeps its file.
  const old = String(draft.content_html || '');
  const known = new Map<string, { key: string; alt: string }>();
  for (const key of inlineImageKeys(old)) {
    const buf = await readFile(key).catch(() => null);
    if (!buf) continue;
    const tag = [...old.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).find((t) => t.includes(UPLOAD_PREFIX + encodeURI(key)) || t.includes(UPLOAD_PREFIX + key));
    known.set(sha(buf), { key, alt: (tag?.match(/\balt="([^"]*)"/i) || [])[1] || '' });
  }

  const notes: string[] = [];
  let content = blog.content;
  let kept = 0;
  let added = 0;
  let dropped = 0;
  for (const [n, img] of dataImages(content).entries()) {
    const bytes = Buffer.from(img.base64, 'base64');
    const same = known.get(sha(bytes));
    let tag = '';
    if (same) {
      tag = `<img src="${UPLOAD_PREFIX}${encodeURI(same.key)}" alt="${same.alt}" />`;
      kept++;
    } else {
      const format = await sharp(bytes).metadata().then((m) => m.format as string).catch(() => '');
      if (EXT[format] && bytes.length <= MAX_IMAGE_BYTES) {
        const key = `inline/draft-${id}-${Date.now()}-${n}${EXT[format]}`;
        await saveFile(key, bytes);
        tag = `<img src="${UPLOAD_PREFIX}${encodeURI(key)}" alt="${escAttr(img.alt)}" />`;
        added++;
      } else {
        dropped++;
      }
    }
    content = content.replace(img.tag, tag);
  }
  content = content.replace(/<p>\s*<\/p>/gi, '');
  if (added) notes.push(`${added} new picture${added > 1 ? 's were' : ' was'} added: check ${added > 1 ? 'their' : 'its'} alt text in the HTML box, or remove and place ${added > 1 ? 'them' : 'it'} again under Images.`);
  if (dropped) notes.push(`${dropped} picture${dropped > 1 ? 's' : ''} could not be kept (only PNG, JPG, WebP or GIF under 8 MB). Add ${dropped > 1 ? 'them' : 'it'} under Images.`);
  if (kept) notes.push(`${kept} picture${kept > 1 ? 's' : ''} already in the blog kept.`);

  // The banner above the title: a different picture from the current cover becomes the cover.
  if (blog.cover) {
    const m = blog.cover.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
    const bytes = m ? Buffer.from(m[1], 'base64') : null;
    if (bytes?.length) {
      let current: Buffer | null = draft.featured_image_path ? await readFile(draft.featured_image_path).catch(() => null) : null;
      if (!current) {
        const row = await prisma.blog_schedule.findFirst({ where: { draft_id: id }, select: { author: true } });
        current = await makeCover(draft.title || 'Untitled', row?.author || draft.author || null).catch(() => null);
      }
      if (!current || sha(current) !== sha(bytes)) {
        const format = await sharp(bytes).metadata().then((x) => x.format as string).catch(() => '');
        if (EXT[format] && bytes.length <= MAX_IMAGE_BYTES) {
          const key = `draft-${id}-${Date.now()}${EXT[format]}`;
          await saveFile(key, bytes);
          if (draft.featured_image_path) await deleteFile(draft.featured_image_path).catch(() => {});
          await prisma.drafts.update({ where: { id }, data: { featured_image_path: key, updated_at: sqlNow() } });
          await activity.log('draft.creative_uploaded', { entityType: 'draft', entityId: id, details: `"${draft.title}" (cover from Word file)`, actor: await getActor() });
          notes.push('The cover (banner) was replaced with the picture above the title in the Word file. This is already saved; check its alt text under Cover.');
        } else {
          notes.push('The picture above the title could not be used as the cover (only PNG, JPG, WebP or GIF under 8 MB). Upload it under Cover.');
        }
      }
    }
  }

  return NextResponse.json({
    cover_changed: notes.some((n) => n.startsWith('The cover (banner) was replaced')),
    title: blog.title || draft.title || '',
    meta_description: blog.meta ?? draft.meta_description ?? '',
    content_html: content,
    notes,
  });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

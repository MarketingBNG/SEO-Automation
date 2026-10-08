import { NextRequest, NextResponse } from 'next/server';
import sharp, { type Metadata } from 'sharp';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { saveFile, mimeFor } from '@/lib/storage';
import { imageSlots, sectionHeadings, isFaqHeading, imageTag, placeAtSlot, placeAfterSection, removeNote } from '@/lib/blogImages';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
// The file's real format (from its bytes, not its name) decides the extension it is stored under.
const EXT: Record<string, string> = { png: '.png', jpeg: '.jpg', jpg: '.jpg', webp: '.webp', gif: '.gif' };

// GET: where images can go in this draft (the writer's suggestions and the section headings).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const draft = await prisma.drafts.findUnique({ where: { id: toId((await params).id) }, select: { content_html: true } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ slots: imageSlots(draft.content_html || ''), headings: sectionHeadings(draft.content_html || '') });
}

// POST (multipart): image + alt + caption? + slot (a suggestion's index) or heading (an H2's index):
// stores the image and puts it into the article at that spot.
// POST (JSON) { action: 'remove_note', slot }: deletes a suggestion note the team does not want.
// Neither changes updated_at: the words are the same, so the fact check still covers them.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const draft: any = await prisma.drafts.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.status === 'published') return NextResponse.json({ error: 'This blog is already published. Change images on the live post through the assistant.' }, { status: 409 });
  const actor = await getActor();
  const html = draft.content_html || '';

  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const body: any = (await req.json().catch(() => ({}))) || {};
    if (body.action !== 'remove_note' || !Number.isInteger(body.slot) || body.slot < 0) return NextResponse.json({ error: 'action must be remove_note with a slot' }, { status: 400 });
    const next = removeNote(html, body.slot);
    if (next === html) return NextResponse.json({ error: 'That suggestion is no longer in the article.' }, { status: 409 });
    const updated = await prisma.drafts.update({ where: { id }, data: { content_html: next } });
    await activity.log('draft.image_note_removed', { entityType: 'draft', entityId: id, details: `"${draft.title}": image suggestion ${body.slot + 1} removed`, actor });
    return NextResponse.json(updated);
  }

  const form = await req.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No image uploaded' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The image must be under 8 MB.' }, { status: 400 });
  const alt = String(form.get('alt') || '').trim().slice(0, 200);
  if (alt.length < 5) return NextResponse.json({ error: 'Write alt text (a short description of the image, for Google and screen readers).' }, { status: 400 });
  const caption = String(form.get('caption') || '').trim().slice(0, 300);
  const slot = form.get('slot');
  const heading = form.get('heading');

  // Where it goes is settled before anything is stored.
  const bytes = Buffer.from(await file.arrayBuffer());
  let meta: Metadata | null = null;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    meta = null;
  }
  const ext = meta?.format ? EXT[meta.format] : undefined;
  if (!ext) return NextResponse.json({ error: 'Only PNG, JPG, WebP or GIF images can be placed in the article.' }, { status: 400 });
  const key = `inline/draft-${id}-${Date.now()}${ext}`;
  const tag = imageTag(key, alt, caption || undefined);
  let next: string;
  if (slot !== null && slot !== '') {
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: 'slot must be a suggestion number' }, { status: 400 });
    next = placeAtSlot(html, n, tag);
    if (next === html) return NextResponse.json({ error: 'That suggestion is no longer in the article. Reload the draft.' }, { status: 409 });
  } else if (heading !== null && heading !== '') {
    const n = Number(heading);
    const heads = sectionHeadings(html);
    if (!Number.isInteger(n) || n < 0 || n >= heads.length) return NextResponse.json({ error: 'That section is no longer in the article. Reload the draft.' }, { status: 409 });
    if (isFaqHeading(heads[n])) return NextResponse.json({ error: 'Images do not go in the FAQ section: Google reads its answers as plain text.' }, { status: 400 });
    next = placeAfterSection(html, n, tag);
  } else {
    return NextResponse.json({ error: 'Say where the image goes: a suggestion (slot) or a section (heading).' }, { status: 400 });
  }

  await saveFile(key, bytes);
  // The image library keeps the file on record and links it to the draft.
  const img = await prisma.image_library.create({ data: { filename: file.name || key, path: key, mime_type: mimeFor(key), width: meta?.width ?? null, height: meta?.height ?? null, notes: alt } });
  await prisma.draft_images.create({ data: { draft_id: id, image_id: img.id } });
  const updated = await prisma.drafts.update({ where: { id }, data: { content_html: next } });
  await activity.log('draft.image_placed', { entityType: 'draft', entityId: id, details: `"${draft.title}": image added (${alt.slice(0, 80)})`, actor });
  return NextResponse.json({ ...updated, imageKey: key });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

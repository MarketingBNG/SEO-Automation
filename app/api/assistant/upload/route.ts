import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import mammoth from 'mammoth';
import prisma from '@/lib/prisma';
import { saveFile, basename } from '@/lib/storage';

export const runtime = 'nodejs';

const ALLOWED: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_DOC_CHARS = 80000;

// Saves a file attached in the assistant chat. Images: the original (what gets uploaded to
// WordPress) plus a downscaled JPEG copy for the AI to look at. Word documents: converted to HTML
// and returned, so the text travels inside the chat message (e.g. a blog to audit).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const f = form.get('image');
    const file = f && typeof f !== 'string' ? (f as File) : null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    // PORT NOTE: formidable's maxFileSize check (which threw -> 500 with its message) is done here.
    if (file.size > MAX_BYTES) {
      throw new Error(`options.maxTotalFileSize (${MAX_BYTES} bytes) exceeded, received ${file.size} bytes of file data`);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const originalFilename = file.name || '';
    const mimetype = file.type;

    if (mimetype === DOCX || /\.docx$/i.test(originalFilename || '')) {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      return NextResponse.json(
        {
          kind: 'document',
          filename: originalFilename || 'document.docx',
          html: value.slice(0, MAX_DOC_CHARS),
          truncated: value.length > MAX_DOC_CHARS,
        },
        { status: 200 }
      );
    }

    if (!ALLOWED[mimetype]) {
      return NextResponse.json({ error: 'Attach a JPG, PNG, WebP or GIF image, or a Word (.docx) document' }, { status: 400 });
    }

    const safeName = (originalFilename || 'image').replace(/[^a-z0-9._-]+/gi, '-').slice(-80);
    const stamp = Date.now();
    // PORT NOTE: files go to lib/storage under the same relative names (assistant/<stamp>-...); the
    // DB stores those keys.
    const originalKey = `assistant/${stamp}-${safeName.replace(/\.[^.]+$/, '')}${ALLOWED[mimetype]}`;
    await saveFile(originalKey, buf, mimetype);

    const meta = await sharp(buf).metadata();
    const modelKey = `assistant/${stamp}-model.jpg`;
    const modelBuf = await sharp(buf)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    await saveFile(modelKey, modelBuf, 'image/jpeg');

    const r = await prisma.image_library.create({
      data: {
        filename: safeName,
        path: originalKey,
        notes: 'Attached in the assistant chat',
        model_path: modelKey,
        mime_type: mimetype,
        width: meta.width || null,
        height: meta.height || null,
      },
    });

    return NextResponse.json(
      {
        kind: 'image',
        id: Number(r.id),
        filename: safeName,
        width: meta.width,
        height: meta.height,
        url: `/api/uploads/assistant/${basename(originalKey)}`,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };

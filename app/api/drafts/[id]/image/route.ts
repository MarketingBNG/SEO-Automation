import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { saveFile, deleteFile } from '@/lib/storage';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const draft: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No image uploaded' }, { status: 400 });

    // Same name formidable produced before: draft-<id>-<timestamp><original extension>.
    // PORT NOTE: stored in blob storage under that key (was an absolute path in uploads/); the
    // featured_image_path column and the response's `path` now hold the key.
    const key = `draft-${id}-${Date.now()}${path.extname(file.name || '')}`;
    await saveFile(key, Buffer.from(await file.arrayBuffer()), file.type || undefined);

    // Remove old creative if one existed
    if (draft.featured_image_path) {
      await deleteFile(draft.featured_image_path).catch(() => {});
    }

    await prisma.drafts.update({ where: { id: nid }, data: { featured_image_path: key, updated_at: sqlNow() } });

    await activity.log('draft.creative_uploaded', {
      entityType: 'draft',
      entityId: Number(id),
      details: `"${draft.title}"`,
      actor: await getActor(),
    });

    return NextResponse.json({ ok: true, path: key }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { getActor } from '@/lib/auth';
import { startTopicBlog, startTopicArticle, attachManual, compareManual, finalizeManual } from '@/lib/topics';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST (JSON) { action: 'blog' | 'article' | 'compare' | 'finalize', comments? }
// POST (multipart) file=<.docx> [title]: upload a piece written by hand; it is audited at once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const actor = await getActor();
  try {
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return NextResponse.json({ error: 'Attach a .docx file.' }, { status: 400 });
      if (!/\.docx$/i.test(file.name || '')) return NextResponse.json({ error: 'Only .docx files are supported. From Google Docs use File > Download > Microsoft Word (.docx).' }, { status: 400 });
      if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'The file must be under 15 MB.' }, { status: 400 });
      const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(await file.arrayBuffer()) });
      const title = String(form.get('title') || '').trim() || (file.name || '').replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
      return NextResponse.json(await attachManual(id, { title, contentHtml: html, actor }), { status: 202 });
    }
    const body: any = (await req.json().catch(() => ({}))) || {};
    switch (body.action) {
      case 'blog':
        return NextResponse.json(await startTopicBlog(id), { status: 202 });
      case 'article':
        return NextResponse.json(await startTopicArticle(id), { status: 202 });
      case 'compare':
        return NextResponse.json(await compareManual(id));
      case 'finalize':
        return NextResponse.json(await finalizeManual(id, String(body.comments || ''), actor), { status: 202 });
      default:
        return NextResponse.json({ error: 'action must be blog, article, compare or finalize' }, { status: 400 });
    }
  } catch (err: any) {
    if (!err.status) console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

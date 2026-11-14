import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { getActor } from '@/lib/auth';
import { attachManual } from '@/lib/topics';
import { topicAction } from '@/lib/topicsView';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST (JSON) { action: 'blog' | 'article' | 'relevance' | 'compare' | 'finalize', comments? }
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
    // Shared with the assistant's topic_action (lib/topicsView.ts).
    const r = await topicAction(id, body.action, String(body.comments || ''), actor);
    return NextResponse.json(r.body, { status: r.status });
  } catch (err: any) {
    if (!err.status) console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

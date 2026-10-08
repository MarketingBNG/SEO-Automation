import { NextRequest, NextResponse } from 'next/server';
import { renderBlogDocx } from '@/lib/blogDoc';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/drafts/[id]/download: the blog as a Word file in its published layout.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const out = await renderBlogDocx(toId((await params).id));
    if (!out) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return new Response(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
      },
    });
  } catch (err: any) {
    console.error('Word export failed', err);
    return NextResponse.json({ error: 'The Word file could not be made. Try again in a minute; if it keeps failing, tell the team.' }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

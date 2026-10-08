import { NextRequest, NextResponse } from 'next/server';
import { renderLiveBlogDocx } from '@/lib/blogDoc';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/wordpress/download?url=<live post on the company site>: that post as a Word file.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  try {
    const out = await renderLiveBlogDocx(url);
    return new Response(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
      },
    });
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Live post Word export failed', err);
    return NextResponse.json({ error: 'The Word file could not be made. Try again in a minute.' }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

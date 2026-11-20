import { NextRequest, NextResponse } from 'next/server';
import { getActor, getMe } from '@/lib/auth';
import { postMyBlog } from '@/lib/myBlog';
import { authorNames } from '@/lib/authors';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';
// A ticked fact check reads every claim against official sources before anything is posted.
export const maxDuration = 300;

// POST (JSON): Post my blog (Drafts & Review). See lib/myBlog.ts for the fields and what each option does.
// Saving to Drafts needs content work (proxy.ts, lib/permissions.ts); posting live also needs blog.publish_now.
export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send the blog as JSON.' }, { status: 400 });
  const r = await postMyBlog(
    {
      title: String(body.title || ''),
      html: String(body.html || ''),
      meta_description: body.meta_description ?? null,
      keyword: body.keyword ?? null,
      author: body.author ?? null,
      reviewer: body.reviewer ?? null,
      mode: body.mode,
      fact_check: body.fact_check === true,
      originality: body.originality === true,
      optimise: body.optimise === true,
      ask_reviewer: body.ask_reviewer === true,
      cover_key: body.cover_key ?? null,
      cover_data: body.cover_data ?? null,
      checklist: body.checklist ?? null,
      request_key: typeof body.request_key === 'string' ? body.request_key : null,
    },
    { me: await getMe(), actor: await getActor() },
  );
  return NextResponse.json(r.body, { status: r.status });
}
// GET: the author names for the picker (the same list Drafts & Review offers).
export async function GET() {
  return NextResponse.json({ authors: await authorNames().catch(() => []) });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

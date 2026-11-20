import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { publishDraft, canPublishNow } from '@/lib/publishDraft';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Publish (or send as a website draft) an approved Drafts & Review blog. The work is in
// lib/publishDraft.ts, shared with Post my blog and the assistant.
// Body: { wpStatus?: 'publish' | 'draft', reviewer?: string, skipChecks?: boolean, checklist?: {author,
// title, content, banner} }. Going live needs the publish checklist ticked (lib/publishChecklist.ts).
// skipChecks (admin and manager: blog.publish_now): no CA/CPA reviewer name and no paid
// originality check. The free checks that protect the live page always run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const nid = toId((await params).id);
  const body: any = await req.json().catch(() => ({}));
  const skip = body?.skipChecks === true;
  const me = await getMe();
  if (skip && !(await canPublishNow(me))) {
    return NextResponse.json({ error: 'Only an admin or a manager can publish without the CA/CPA reviewer and originality checks.' }, { status: 403 });
  }
  const r = await publishDraft(nid, { wpStatus: body?.wpStatus, reviewer: body?.reviewer, skipExpert: skip, skipOriginality: skip, checklist: body?.checklist, me });
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

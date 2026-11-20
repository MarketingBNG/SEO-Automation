import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor, getMe } from '@/lib/auth';
import { canPublishNow } from '@/lib/publishDraft';
import { setLiveAuthor } from '@/lib/liveBlog';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Drafts & Review, a published blog: "Change author on the live post". POST { author } (one of the
// blog authors). Changes the live post's author, byline and schema through the connector (the same
// code as the assistant's live_blog_set_author) and is recorded as a website change that can be
// undone (POST /api/assistant/undo { changeId }). Needs blog.publish_now (proxy.ts too).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!(await canPublishNow(me))) return NextResponse.json({ error: 'Only an admin or a manager can change a live post.' }, { status: 403 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const draft = await prisma.drafts.findUnique({ where: { id: toId((await params).id) } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (draft.status !== 'published' || !(draft.wp_post_id || draft.wp_post_url)) return NextResponse.json({ error: 'This blog is not live on the website. Change its author in the picker above instead.' }, { status: 409 });
  const actor = await getActor();
  try {
    const { result, change } = await setLiveAuthor(draft.wp_post_url ? { url: draft.wp_post_url } : { post_id: draft.wp_post_id! }, String(body.author || ''), actor);
    const row = await prisma.site_changes.create({ data: { tool: 'live_blog_set_author', summary: change.summary, target_type: change.targetType, target_id: change.targetId, undo: JSON.stringify(change.undo) } });
    await activity.log('assistant.site_change', { entityType: 'draft', entityId: draft.id, details: `${change.summary} (Drafts & Review)`, actor, source: 'dashboard' });
    return NextResponse.json({ ok: true, changeId: row.id, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { recordChange, restorePoint } from '@/lib/contentChanges';
import { markEditedAsChecked } from '@/lib/factCheckMark';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// POST { changeId }: put back the words the draft had before that optimisation or rewrite.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  const { changeId }: any = (await req.json().catch(() => ({}))) || {};
  const point = await restorePoint(Number(changeId));
  if (!point || point.change.entity_type !== 'draft' || point.change.entity_id !== id) return NextResponse.json({ error: 'That earlier version is not available for this draft.' }, { status: 404 });
  const d = await prisma.drafts.findUnique({ where: { id } });
  if (!d) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (d.status === 'published') return NextResponse.json({ error: 'This blog is already published; edit the live post instead.' }, { status: 409 });
  const actor = await getActor();
  await prisma.drafts.update({
    where: { id },
    data: { title: point.title ?? d.title, meta_description: point.meta ?? d.meta_description, content_html: point.html, word_count: point.html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, updated_at: sqlNow() },
  });
  await recordChange({ entityType: 'draft', entityId: id, kind: 'restore', actor, title: point.title ?? d.title, before: { title: d.title, meta: d.meta_description, html: d.content_html || '' }, after: { title: point.title ?? d.title, meta: point.meta ?? d.meta_description, html: point.html } }).catch(() => null);
  await markEditedAsChecked(id, actor || 'Restore', { byPerson: false }).catch(() => {});
  await activity.log('draft.restored', { entityType: 'draft', entityId: id, details: `"${d.title}": the version before the ${point.change.kind} of ${point.change.created_at} UTC is back`, actor });
  return NextResponse.json({ ok: true });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

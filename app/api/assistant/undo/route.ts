import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { undoChange } from '@/lib/assistant/tools';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { changeId, force } = (await req.json().catch(() => ({}))) || {};

  // PORT NOTE: SQLite matched `id = ?` loosely; coerce to Number for Prisma (invalid -> not found).
  const id = Number(changeId);
  const change = Number.isInteger(id) ? await prisma.site_changes.findUnique({ where: { id } }) : null;
  if (!change) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
  if (change.status === 'undone') return NextResponse.json({ error: 'This change was already undone' }, { status: 400 });
  if (!change.undo) return NextResponse.json({ error: 'This change cannot be undone automatically' }, { status: 400 });

  try {
    const message = await undoChange(JSON.parse(change.undo), { force: Boolean(force) });
    await prisma.site_changes.update({ where: { id: change.id }, data: { status: 'undone', undone_at: sqlNow() } });
    await activity.log('assistant.site_change_undone', {
      entityType: change.target_type || 'site',
      entityId: Number(change.target_id) || null,
      details: `Undid: ${change.summary}`,
      actor: await getActor(),
    });
    return NextResponse.json({ ok: true, message }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: err.code === 'CHANGED_SINCE' ? 409 : 500 });
  }
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };

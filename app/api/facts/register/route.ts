import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Verified Facts Register. A held blog publishes on the next scheduler run once its figure is here.
export async function GET() {
  return NextResponse.json(await prisma.verified_facts.findMany({ orderBy: { id: 'desc' } }));
}

export async function POST(req: NextRequest) {
  const { value, claim, source_url }: any = (await req.json().catch(() => ({}))) || {};
  if (!value?.trim() || !claim?.trim() || !source_url?.trim()) return NextResponse.json({ error: 'Figure, claim and official source URL are all required.' }, { status: 400 });
  const actor = await getActor();
  const row = await prisma.verified_facts.create({ data: { value: value.trim(), claim: claim.trim(), source_url: source_url.trim(), verified_by: actor } });
  await activity.log('facts.verified', { entityType: 'verified_fact', entityId: row.id, details: `${row.value}: ${row.claim}`, actor });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.verified_facts.delete({ where: { id } });
  await activity.log('facts.removed', { entityType: 'verified_fact', entityId: id, actor: await getActor() });
  return NextResponse.json({ ok: true });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH };

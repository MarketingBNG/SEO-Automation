import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { strategyView, editSection } from '@/lib/strategy/service';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const row = await prisma.seo_strategies.findUnique({ where: { id: toId((await params).id) } });
  if (!row?.plan_json) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await strategyView(row));
}

// Edit Strategy: { section, value }. Every save is written to the audit log and re-validated.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { section, value }: any = (await req.json().catch(() => ({}))) || {};
  try {
    return NextResponse.json(await editSection(toId((await params).id), section, value, await getActor()));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE };

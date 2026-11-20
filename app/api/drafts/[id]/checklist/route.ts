import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/auth';
import { checklistState, setTicks, CHECK_ITEMS } from '@/lib/publishChecklist';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// The publish checklist of a draft (lib/publishChecklist.ts). GET: each item, whether it is ticked for
// what the blog holds now, and what it shows. POST { author?, title?, content?, banner? } (true ticks,
// false unticks): saved under the signed-in person's name.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const d = await prisma.drafts.findUnique({ where: { id: toId((await params).id) } });
  if (!d) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json(await checklistState(d));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const ticks = Object.fromEntries(CHECK_ITEMS.filter((k) => typeof body[k] === 'boolean').map((k) => [k, body[k]]));
  if (!Object.keys(ticks).length) return NextResponse.json({ error: 'Send at least one of author, title, content, banner as true or false.' }, { status: 400 });
  try {
    return NextResponse.json(await setTicks(toId((await params).id), ticks, await getActor()));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { guideFor, setManualDone } from '@/lib/strategy/manual';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// { kind: 'backlink' | 'fix', id, action: 'guide' | 'done' | 'undo', regenerate? }
export async function POST(req: NextRequest) {
  const { kind, id, action, regenerate }: any = (await req.json().catch(() => ({}))) || {};
  if (!['backlink', 'fix'].includes(kind) || !Number.isInteger(Number(id))) return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
  try {
    if (action === 'guide') return NextResponse.json({ guide: await guideFor(kind, Number(id), { regenerate: Boolean(regenerate) }) });
    if (action === 'done' || action === 'undo') return NextResponse.json(await setManualDone(kind, Number(id), action === 'done', await getActor()));
    return NextResponse.json({ error: 'action must be guide, done or undo' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { creditStatus, setBalance, resumeAi, pauseAi } from '@/lib/aiCredits';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: models in use, estimated spend and remaining credit, pause state.
export async function GET() {
  return NextResponse.json(await creditStatus());
}

// POST { action: 'set_balance', balance, threshold? } after a top-up (also lifts the pause),
// { action: 'resume' } or { action: 'pause' }.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const actor = await getActor();
  if (body.action === 'set_balance') {
    const usd = Number(body.balance);
    if (!Number.isFinite(usd) || usd < 0) return NextResponse.json({ error: 'Enter the balance in US dollars.' }, { status: 400 });
    const threshold = body.threshold === undefined || body.threshold === '' ? undefined : Number(body.threshold);
    await setBalance(usd, actor, threshold);
  } else if (body.action === 'resume') {
    await resumeAi(actor);
  } else if (body.action === 'pause') {
    await pauseAi(`Paused by ${actor}.`);
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json(await creditStatus());
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

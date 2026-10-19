import { NextRequest, NextResponse } from 'next/server';
import { creditStatus, setBalance, resumeAi, pauseAi, autoResumeAi, spendWindow } from '@/lib/aiCredits';
import { checkKey } from '@/lib/anthropicClient';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: models in use, estimated spend and remaining credit, pause state.
// ?days=N adds the spend of the last N days by kind of work and model.
export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(0, Number(req.nextUrl.searchParams.get('days')) || 0));
  return NextResponse.json({ ...(await creditStatus()), ...(days ? { window: await spendWindow(days) } : {}) });
}

// POST { action: 'set_balance', balance, threshold? } after a top-up (also lifts the pause),
// { action: 'test_keys' }, { action: 'resume' } or { action: 'pause' }.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const actor = await getActor();
  if (body.action === 'set_balance') {
    const usd = Number(body.balance);
    if (!Number.isFinite(usd) || usd < 0) return NextResponse.json({ error: 'Enter the balance in US dollars.' }, { status: 400 });
    const threshold = body.threshold === undefined || body.threshold === '' ? undefined : Number(body.threshold);
    await setBalance(usd, actor, threshold);
  } else if (body.action === 'test_keys') {
    // Each key's answer from Anthropic; if one works while AI work is paused, work starts again.
    const keys = [await checkKey('main'), await checkKey('secondary')];
    const resumed = keys.some((k) => k.ok) ? await autoResumeAi().catch(() => null) : null;
    return NextResponse.json({ ...(await creditStatus()), keyTest: keys, resumed });
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

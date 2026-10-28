import { NextRequest, NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { EDITABLE_SETTINGS, isEditableSetting } from '@/lib/permissions';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Only the user-editable keys: role access, AI credit state, run guards and paid API caches stay
// behind their own routes (they are also not needed by the pages that read this).
async function editable() {
  const all = await settings.getAll();
  const out: Record<string, any> = {};
  for (const key of EDITABLE_SETTINGS) if (key in all) out[key] = all[key];
  return out;
}

export async function GET() {
  return NextResponse.json(await editable(), { status: 200 });
}

export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const refused = Object.keys(body).filter((k) => !isEditableSetting(k));
  if (refused.length) {
    return NextResponse.json({ error: `These settings cannot be changed here: ${refused.join(', ')}.` }, { status: 400 });
  }
  for (const [key, value] of Object.entries(body)) {
    await settings.set(key, value);
  }
  await activity.log('settings.updated', {
    entityType: 'settings',
    details: Object.keys(body).join(', '),
    actor: await getActor(),
  });
  return NextResponse.json(await editable(), { status: 200 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

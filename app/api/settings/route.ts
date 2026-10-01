import { NextRequest, NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(await settings.getAll(), { status: 200 });
}

export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  for (const [key, value] of Object.entries(body)) {
    await settings.set(key, value);
  }
  await activity.log('settings.updated', {
    entityType: 'settings',
    details: Object.keys(body).join(', '),
    actor: await getActor(),
  });
  return NextResponse.json(await settings.getAll(), { status: 200 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

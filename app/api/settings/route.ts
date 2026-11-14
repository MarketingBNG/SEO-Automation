import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { editableSettings, saveSettings } from '@/lib/writingRules';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(await editableSettings(), { status: 200 });
}

// Only the user-editable keys (lib/writingRules.ts, shared with the assistant's update_writing_rules).
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await saveSettings(body, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

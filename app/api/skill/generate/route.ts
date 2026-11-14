import { NextResponse } from 'next/server';
import { generateSkillNow } from '@/lib/writingRules';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// "Update the skill now" (lib/writingRules.ts, shared with the assistant). One paid run at a time;
// in Testing mode the run waits in the free Claude Code queue.
export async function POST() {
  const r = await generateSkillNow();
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

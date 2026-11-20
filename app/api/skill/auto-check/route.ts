// Idempotent, cron-safe: only actually regenerates the skill if it's missing or 15+ days old.
// The built-in scheduler (lib/scheduler.ts) calls the same work daily; an external cron calling
// here is still safe, it's a no-op most days. Only automatic runs start it: a person uses
// "Update skill" (app/api/skill/generate), which has its own guards and logging.
import { NextResponse } from 'next/server';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';
import { runAutomatic } from '@/lib/aiQueue';
import { autoRefreshSkill } from '@/lib/skillAutoRefresh';

export const runtime = 'nodejs';

async function run() {
  const r = await autoRefreshSkill();
  return NextResponse.json(r, { status: r.started ? 202 : 200 });
}

// Cron only (CRON_SECRET), GET or POST: a signed-in browser cannot start this paid batch refresh.
// Any other request keeps the old 405.
export async function GET(req: Request) {
  // Automatic work: in Testing mode it does not use AI (lib/aiQueue.ts).
  if (isCronRequest(req)) return runAutomatic(() => run());
  return methodNotAllowed();
}
export { GET as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

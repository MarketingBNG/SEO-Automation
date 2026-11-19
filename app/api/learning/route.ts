import { NextResponse } from 'next/server';
import { learningFeed } from '@/lib/learningFeed';
import { getMe } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: what the team changed in blogs, what the writer has learned from it, and what the team
// asks the dashboard for (keywords researched, topics taken up, assistant questions, audits).
// Needs content.work (lib/permissions.ts); assistant questions are the person's own unless admin.
export async function GET() {
  return NextResponse.json(await learningFeed(await getMe()));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextResponse } from 'next/server';
import { learningFeed } from '@/lib/learningFeed';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: what the team changed in blogs, what the writer has learned from it, and what the team
// asks the dashboard for (keywords researched, topics taken up, assistant questions, audits).
export async function GET() {
  return NextResponse.json(await learningFeed());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

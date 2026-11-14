import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { recheckDraft } from '@/lib/draftRecheck';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST: check the open issues of a draft that needs attention again, against the current article.
// With { fix: true }: the issues still open are fixed first. See lib/draftRecheck.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fix = Boolean(((await req.json().catch(() => ({}))) as any)?.fix);
  const r = await recheckDraft(toId((await params).id), fix, await getActor().catch(() => 'system'));
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

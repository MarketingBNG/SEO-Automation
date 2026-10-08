import { NextRequest, NextResponse } from 'next/server';
import { checkDraftOriginality } from '@/lib/originality';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 180;

// POST: run the plagiarism check for this draft now (Google top results + our own blogs).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await checkDraftOriginality(toId((await params).id));
    if (!r) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(r);
  } catch (err: any) {
    console.error('Plagiarism check failed', err);
    return NextResponse.json({ error: 'The plagiarism check could not run. Try again in a minute.' }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

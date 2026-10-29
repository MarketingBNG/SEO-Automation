import { NextRequest, NextResponse } from 'next/server';
import { changesFor } from '@/lib/contentChanges';
import { methodNotAllowed, toId } from '../_lib/http';

export const runtime = 'nodejs';

// GET ?entity=draft|audit&id=<id>: what changed in this blog's words, newest first.
export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get('entity');
  if (entity !== 'draft' && entity !== 'audit') return NextResponse.json({ error: 'entity must be draft or audit' }, { status: 400 });
  const id = toId(req.nextUrl.searchParams.get('id'));
  return NextResponse.json({ changes: await changesFor(entity, id, 15) });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

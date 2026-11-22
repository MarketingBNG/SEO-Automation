import { NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { mintHandoff } from '@/lib/seb';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Minted in the signed-in regular browser (Google session). Returns a short-lived, single-use code the
// person carries into SEB. No durable secret leaves the server.
export async function POST() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const { code, expiresAt } = await mintHandoff(me.email);
  return NextResponse.json({ code, expiresAt });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

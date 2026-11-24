import { NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { diagnostics } from '@/lib/zohoPeople';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Admin-only, read-only, secret-free diagnostics for the Zoho People OAuth connect. Shows exactly what
// the server would send to Zoho (redirect_uri, accounts host, scope, region match, authorize URL) so a
// redirect/region mismatch is pinpointed without reading env or the Zoho API console. No secret, token or
// authorization code is ever returned.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  if (me.role !== 'admin') return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  return NextResponse.json(diagnostics());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

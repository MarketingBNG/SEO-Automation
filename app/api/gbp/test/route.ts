import { NextResponse } from 'next/server';
import { hasStoredTokens } from '@/lib/gbpAuth';
import { listAccountsAndLocations } from '@/lib/gbp';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  if (!(await hasStoredTokens())) {
    return NextResponse.json({ ok: false, connected: false, error: 'Not connected yet.' }, { status: 200 });
  }
  try {
    const results = await listAccountsAndLocations();
    return NextResponse.json({ ok: true, connected: true, accounts: results }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, connected: true, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

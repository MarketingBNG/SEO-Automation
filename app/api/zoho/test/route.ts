import { NextResponse } from 'next/server';
import { hasStoredTokens } from '@/lib/zohoAuth';
import { testConnection } from '@/lib/zoho';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  if (!(await hasStoredTokens())) {
    return NextResponse.json({ ok: false, connected: false, error: 'Not connected yet.' }, { status: 200 });
  }
  try {
    const org: any = await testConnection();
    return NextResponse.json({ ok: true, connected: true, orgName: org?.company_name }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, connected: true, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

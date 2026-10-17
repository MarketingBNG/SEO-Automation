import { NextResponse } from 'next/server';
import { hasStoredTokens } from '@/lib/gbpAuth';
import { listAccountsAndLocations } from '@/lib/gbp';

export const runtime = 'nodejs';

// Google's raw errors in plain words: sign-in worked, but Google refuses the data until its API
// access is approved or the APIs are switched on.
function explain(msg: string): string {
  if (/quota|rate ?limit|limit.*\b0\b|RESOURCE_EXHAUSTED/i.test(msg)) {
    return `Sign-in is done, but Google has not approved Business Profile API access for this Google Cloud project yet (its quota is 0). Submit Google's "Business Profile API access request" form for this project and wait for approval (usually a few days); then press Test again. Google said: ${msg}`;
  }
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
    return `Sign-in is done, but one of the Business Profile APIs is switched off in Google Cloud. Enable "My Business Account Management API", "My Business Business Information API" and "Business Profile Performance API" for this project, wait 5 minutes, then Test again. Google said: ${msg}`;
  }
  if (/invalid_grant|refresh token|unauthorized|401/i.test(msg)) {
    return `Google sign-in has expired or was withdrawn. Click Connect again and approve with the account that manages the listing. Google said: ${msg}`;
  }
  if (/permission|403/i.test(msg)) {
    return `The Google account you approved with cannot see the Business Profile. Click Connect again and sign in with an owner or manager of the USAIndiaCFO listing. Google said: ${msg}`;
  }
  return msg;
}

// Old handler accepted any method.
async function handler() {
  if (!(await hasStoredTokens())) {
    return NextResponse.json({ ok: false, connected: false, error: 'Not connected yet.' }, { status: 200 });
  }
  try {
    const results = await listAccountsAndLocations();
    if (!results.length) return NextResponse.json({ ok: false, connected: true, error: 'Signed in, but this Google account manages no Business Profile. Click Connect again and use an owner or manager of the USAIndiaCFO listing.' }, { status: 200 });
    return NextResponse.json({ ok: true, connected: true, accounts: results }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, connected: true, error: explain(String(err?.message || err)) }, { status: 200 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

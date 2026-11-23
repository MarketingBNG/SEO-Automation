import { NextResponse } from 'next/server';
import { SEB_BUILD_TAG } from '@/lib/sebBuild';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Public (no session): confirms which /seb build Coolify is actually running. Open it or curl it:
//   GET https://seo.usaindiacfo.us/api/seb/version  ->  { build: "seb-...", time: "..." }
// If this does not match the expected tag, Coolify is serving an older build (rebuild/redeploy).
export function GET() {
  return NextResponse.json({ build: SEB_BUILD_TAG, time: new Date().toISOString() });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

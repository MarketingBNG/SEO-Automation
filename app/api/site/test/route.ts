import { NextResponse } from 'next/server';
import { testConnection, siteConfigured, SITE_NOT_SET_UP } from '@/lib/site';

export const runtime = 'nodejs';

// Settings > Website connection: a signed ping to the website's connector.
async function handler() {
  // Not set up is not a failure: 200 with connected:false, so Settings shows 'Not connected'.
  if (!siteConfigured()) return NextResponse.json({ ok: false, connected: false, error: SITE_NOT_SET_UP });
  try {
    const r = await testConnection();
    return NextResponse.json({ ok: true, site: r.site, storage: r.storage, draftsAllowed: r.drafts }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST };

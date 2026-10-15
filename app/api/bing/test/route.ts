import { NextResponse } from 'next/server';
import { testBing, bingViaWordPress } from '@/lib/bing';

export const runtime = 'nodejs';

async function handler() {
  if (!process.env.BING_WEBMASTER_API_KEY) {
    // No key here: Bing can still get new posts through WordPress itself.
    const wp: any = await bingViaWordPress();
    if (wp.plugins?.length) return NextResponse.json({ ok: true, via: 'wordpress', site: process.env.WORDPRESS_SITE_URL || 'usaindiacfo.com', plugins: wp.plugins });
    const why = wp.error ? ` (the WordPress plugin list could not be read: ${wp.error})` : ' (no Bing or IndexNow plugin is active on WordPress)';
    return NextResponse.json({ ok: false, connected: false, error: `BING_WEBMASTER_API_KEY is not set in Coolify${why}.` });
  }
  try {
    return NextResponse.json({ ok: true, ...(await testBing()) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
export { handler as GET, handler as POST };

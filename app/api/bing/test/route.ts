import { NextResponse } from 'next/server';
import { testBing } from '@/lib/bing';

export const runtime = 'nodejs';

async function handler() {
  if (!process.env.BING_WEBMASTER_API_KEY) return NextResponse.json({ ok: false, connected: false, error: 'BING_WEBMASTER_API_KEY is not set in Coolify.' });
  try {
    return NextResponse.json({ ok: true, ...(await testBing()) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
export { handler as GET, handler as POST };

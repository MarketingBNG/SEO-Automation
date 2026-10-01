import { NextResponse } from 'next/server';
import { checkRanking } from '@/lib/serphouse';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const siteUrl = process.env.WORDPRESS_SITE_URL || 'usaindiacfo.com';
    const result = await checkRanking('virtual cfo services', siteUrl);
    return NextResponse.json({ ok: true, sample: result }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

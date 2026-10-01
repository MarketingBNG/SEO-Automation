import { NextRequest, NextResponse } from 'next/server';
import { checkRanking } from '@/lib/serphouse';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim();
  if (!keyword) return NextResponse.json({ error: 'keyword is required' }, { status: 400 });

  try {
    const siteUrl = process.env.WORDPRESS_SITE_URL || 'usaindiacfo.com';
    const result: any = await checkRanking(keyword, siteUrl);
    await activity.log('serphouse.checked', {
      entityType: 'serphouse',
      details: `"${keyword}" → ${result.position ? `position ${result.position}` : 'not in results'}`,
      actor: await getActor(),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

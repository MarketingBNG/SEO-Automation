import { NextRequest, NextResponse } from 'next/server';
import { getTermsForKeyword } from '@/lib/surfer';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Consumes one Surfer credit per call - only ever triggered by an explicit button click in the
// dashboard, never run automatically.
export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const keyword = (body?.keyword || '').trim();
  if (!keyword) return NextResponse.json({ error: 'keyword is required' }, { status: 400 });

  try {
    const result: any = await getTermsForKeyword(keyword);
    await activity.log('surfer.terms_fetched', {
      entityType: 'surfer',
      details: `"${keyword}" → ${result.terms.length} terms (1 Surfer credit used)`,
      actor: await getActor(),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

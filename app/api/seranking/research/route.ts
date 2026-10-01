import { NextRequest, NextResponse } from 'next/server';
import { researchKeywords } from '@/lib/seranking';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const keyword = req.nextUrl.searchParams.get('keyword');
    const type = req.nextUrl.searchParams.get('type');
    if (!keyword) return NextResponse.json({ error: 'keyword is required' }, { status: 400 });
    const results = await researchKeywords(type || 'similar', keyword, { limit: 30 });
    return NextResponse.json(results, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

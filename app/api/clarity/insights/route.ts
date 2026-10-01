import { NextRequest, NextResponse } from 'next/server';
import { getInsights } from '@/lib/clarity';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const numOfDays = Math.min(parseInt(req.nextUrl.searchParams.get('numOfDays') as any, 10) || 3, 3);
    const data = await getInsights({ numOfDays });
    return NextResponse.json(data, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

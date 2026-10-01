import { NextRequest, NextResponse } from 'next/server';
import { getRecentTranscripts } from '@/lib/fireflies';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') as any, 10) || 10, 50);
    const transcripts = await getRecentTranscripts(limit);
    return NextResponse.json(transcripts, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

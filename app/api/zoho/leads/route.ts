import { NextResponse } from 'next/server';
import { getLeadSourceBreakdown } from '@/lib/zoho';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const summary = await getLeadSourceBreakdown();
    return NextResponse.json(summary, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

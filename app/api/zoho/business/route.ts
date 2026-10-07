import { NextRequest, NextResponse } from 'next/server';
import { businessResults, TRACKING_SNIPPET } from '@/lib/leadAttribution';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET /api/zoho/business?days=90: leads, consults and signed clients by blog topic and service.
export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 90));
  try {
    return NextResponse.json({ ...(await businessResults({ days })), snippet: TRACKING_SNIPPET });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, snippet: TRACKING_SNIPPET }, { status: 200 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import { getWorkToken } from '@/lib/workToken';
import { gateForToken } from '@/lib/worklog';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The device kiosk poller asks here with the person's work token (x-work-token header): is this
// person's laptop locked to the lesson right now? { locked: boolean }. No sign-in; the token
// identifies the person. The proxy lets the work token reach only this and the report endpoint.
export async function GET(req: NextRequest) {
  const token = getWorkToken(req);
  if (!token) return NextResponse.json({ error: 'No work token' }, { status: 401 });
  return NextResponse.json(await gateForToken(token));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

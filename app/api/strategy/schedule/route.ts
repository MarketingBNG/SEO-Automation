import { NextResponse } from 'next/server';
import { methodNotAllowed } from '../../_lib/http';
import { calendarView } from '@/lib/strategy/calendarRows';

export const runtime = 'nodejs';

// The approved month's blog calendar with live status (planned, in review, held, published).
export async function GET() {
  return NextResponse.json(await calendarView());
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

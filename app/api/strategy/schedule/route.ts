import { methodNotAllowed } from '../../_lib/http';
import { calendarView } from '@/lib/strategy/calendarRows';
import { jsonResponse, sharedJson } from '@/lib/sharedRead';

export const runtime = 'nodejs';

// The approved month's blog calendar with live status (planned, in review, held, published).
// The same for everyone: shared for 5 seconds unless something changes (lib/sharedRead.ts).
export async function GET() {
  return jsonResponse(await sharedJson('calendar', 5000, calendarView));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

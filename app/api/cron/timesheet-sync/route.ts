import { NextResponse } from 'next/server';
import { processQueue } from '@/lib/timesheetSync';
import { logTime } from '@/lib/zohoProjects';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Drains the timesheet sync queue: posts each pending prior worked day's hours under its own IST date to
// the captured team project's General task. Only the scheduled task (CRON_SECRET) runs it; a signed-in
// browser cannot start paid Zoho writes here. Idempotent (see lib/timesheetSync).
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Cron only' }, { status: 403 });
  const results = await processQueue({
    logTime: async (email, projectId, day, hours) => {
      const r: any = await logTime(email, projectId, day, hours);
      return { zohoLogId: r?.zohoLogId || null };
    },
  });
  return NextResponse.json({ processed: results.length, results });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

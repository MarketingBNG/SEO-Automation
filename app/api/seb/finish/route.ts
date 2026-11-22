import { NextRequest, NextResponse } from 'next/server';
import { sebSessionEmail, SEB_COOKIE } from '@/lib/seb';
import { markRead, submitTest } from '@/lib/associateTraining';
import { gateForEmail } from '@/lib/worklog';
import * as settings from '@/lib/settings';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// SEB Finish: the server saves the completion (lesson read / test submitted) and ONLY returns the quit
// URL once it re-checks the gate and sees the day is done. If saving fails, no quit URL is returned, so
// SEB does not quit.
export async function POST(req: NextRequest) {
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  try {
    if (body.kind === 'lesson') {
      if (!body.lessonId) return NextResponse.json({ error: 'lessonId required' }, { status: 400 });
      await markRead(email, Number(body.lessonId));
    } else if (body.kind === 'test') {
      if (!body.testId) return NextResponse.json({ error: 'testId required' }, { status: 400 });
      await submitTest(email, Number(body.testId), body.answers || {}, { log: body.log, signals: body.signals, written: body.written });
    } else {
      return NextResponse.json({ error: 'kind must be lesson or test' }, { status: 400 });
    }
  } catch (e: any) {
    // Completion was not saved -> no quit URL. SEB stays on the training.
    return NextResponse.json({ error: `Could not save completion: ${e?.message || e}`, done: false, quitUrl: '' }, { status: e?.status || 500 });
  }
  // Verify against the gate: quit only when the server confirms today is done.
  const gate = await gateForEmail(email);
  const done = gate.status === 'done';
  const quitUrl = done ? String((await settings.get('seb_quit_url')) || process.env.SEB_QUIT_URL || '') : '';
  return NextResponse.json({ status: gate.status, done, quitUrl });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

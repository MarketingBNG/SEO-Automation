import { NextRequest, NextResponse } from 'next/server';
import prismaClient from '@/lib/prisma';
import { sebSessionEmail, SEB_COOKIE, resolveSebQuitUrl, sebLog, newReqId, withTimeout } from '@/lib/seb';
import { gateForEmail } from '@/lib/worklog';
import { sebTodayItem } from '@/lib/associateTrainingView';
import { attendanceStatus } from '@/lib/attendance';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
const prisma: any = prismaClient;

// The assigned lesson/test must reach SEB even if the attendance read is slow or fails, so attendance is
// bounded; it is a status line, not the gate.
const ATTENDANCE_TIMEOUT_MS = 4000;

// Today's assigned item for the SEB session. Reuses the gate contract: status is one of before-window /
// pending / done / not-ready / no-training / error. The item is returned only while pending (locked).
export async function GET(req: NextRequest) {
  const rid = newReqId();
  const t0 = Date.now();
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) { sebLog('today', rid, 'no-session', { ms: Date.now() - t0 }); return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 }); }

  const member = await prisma.team_members.findUnique({ where: { email }, select: { role: true, name: true } }).catch(() => null);
  const tGate = Date.now();
  const gate = await gateForEmail(email);
  sebLog('today', rid, 'gate', { ms: Date.now() - tGate, status: gate.status });

  let item: any = null;
  if (gate.status === 'pending') {
    const tItem = Date.now();
    item = await sebTodayItem(email, member?.role || 'user').catch((e: any) => { sebLog('today', rid, 'item-error', { msg: String(e?.message || e) }); return null; });
    sebLog('today', rid, 'item', { ms: Date.now() - tItem, has: Boolean(item), kind: item?.kind || 'none' });
  }

  // Attendance is a non-blocking status line. If the read is slow or fails, the lesson/test still ships;
  // the page shows attendance as "unknown" and its Check In button lets the person retry.
  const tAtt = Date.now();
  const att = await withTimeout(attendanceStatus(email), ATTENDANCE_TIMEOUT_MS, { status: 'unknown' as string });
  const attendance = att.value;
  sebLog('today', rid, 'attendance', { ms: Date.now() - tAtt, status: attendance.status, timedOut: att.timedOut });

  // On a no-training day (e.g. Sunday) the SEB page quits to the desktop. This is read-only: it does
  // not mark training complete and does not enqueue a timesheet sync. The quit URL is given only for
  // no-training so the page cannot quit while training is pending.
  const quitUrl = gate.status === 'no-training' ? await resolveSebQuitUrl() : '';
  sebLog('today', rid, 'done', { ms: Date.now() - t0, status: gate.status });
  return NextResponse.json({ status: gate.status, locked: gate.locked, name: member?.name || null, item, attendance, quitUrl });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

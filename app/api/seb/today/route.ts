import { NextRequest, NextResponse } from 'next/server';
import prismaClient from '@/lib/prisma';
import { sebSessionEmail, SEB_COOKIE } from '@/lib/seb';
import { gateForEmail } from '@/lib/worklog';
import { sebTodayItem } from '@/lib/associateTrainingView';
import { attendanceStatus } from '@/lib/attendance';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
const prisma: any = prismaClient;

// Today's assigned item for the SEB session. Reuses the gate contract: status is one of before-window /
// pending / done / not-ready / no-training / error. The item is returned only while pending (locked).
export async function GET(req: NextRequest) {
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 });
  const member = await prisma.team_members.findUnique({ where: { email }, select: { role: true, name: true } }).catch(() => null);
  const gate = await gateForEmail(email);
  const item = gate.status === 'pending' ? await sebTodayItem(email, member?.role || 'user') : null;
  const attendance = await attendanceStatus(email);
  return NextResponse.json({ status: gate.status, locked: gate.locked, name: member?.name || null, item, attendance });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

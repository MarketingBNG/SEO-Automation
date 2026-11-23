import { NextRequest, NextResponse } from 'next/server';
import prismaClient from '@/lib/prisma';
import { sebSessionEmail, SEB_COOKIE, sebLog, newReqId } from '@/lib/seb';
import { playGame } from '@/lib/associateTraining';
import { lessonIdsOf } from '@/lib/trainingContent';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
const prisma: any = prismaClient;

// Optional lesson game inside SEB. Authorized by the SEB session (not a dashboard login) and scoped to
// THIS person's assigned lessons: a game can only be submitted for a lesson in their own profile. Scoring
// is the same server-side scoring as the dashboard (playGame), so points, the best-round rule and the
// streak are identical. Playing a game does NOT complete the lesson or close SEB; the lesson's Finished
// button still does that.
export async function POST(req: NextRequest) {
  const rid = newReqId();
  const email = await sebSessionEmail(req.cookies.get(SEB_COOKIE)?.value);
  if (!email) return NextResponse.json({ error: 'No SEB session. Check in again.' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const lessonId = Number(body.lessonId);
  if (!lessonId) return NextResponse.json({ error: 'lessonId required' }, { status: 400 });

  // Only the person's own assigned lessons may be submitted through the SEB session.
  const profile = await prisma.training_profiles.findUnique({ where: { email } });
  const assigned = profile ? Object.values(lessonIdsOf(profile)).filter(Boolean) : [];
  if (!assigned.includes(lessonId)) {
    sebLog('game', rid, 'not-assigned', { lessonId });
    return NextResponse.json({ error: 'This is not one of your lessons.' }, { status: 403 });
  }
  try {
    const r = await playGame(email, lessonId, body.answers || {});
    sebLog('game', rid, 'played', { lessonId, points: r.points, max: r.max });
    return NextResponse.json(r);
  } catch (e: any) {
    sebLog('game', rid, 'error', { lessonId, msg: String(e?.message || e) });
    return NextResponse.json({ error: e?.message || 'Could not play the game.' }, { status: e?.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

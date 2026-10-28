import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AREAS, areaOf, actionLabel } from '@/lib/activityAreas';
import { methodNotAllowed } from '../../_lib/http';
import { getMe } from '@/lib/auth';
import { runningTimers } from '@/lib/jobTimer';

export const runtime = 'nodejs';

// ?person=<email|automatic>&area=<area name>&q=<text>&limit=
// Returns the rows plus the people and areas for the filter dropdowns.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') as any, 10) || 300, 1000);
  const person = sp.get('person') || '';
  const area = sp.get('area') || '';
  const q = (sp.get('q') || '').trim();
  const where: any = { AND: [] };
  // An admin sees everyone's work; everyone else sees their own (and the automatic runs they look at).
  const me = await getMe();
  const admin = me?.role === 'admin';
  if (!admin && me) where.AND.push({ OR: [{ actor_email: me.email }, ...(person === 'automatic' ? [{ actor_email: null }] : [])] });
  else if (person === 'automatic') where.AND.push({ actor_email: null });
  else if (person) where.AND.push({ actor_email: person });
  if (area) {
    const prefixes = Object.entries(AREAS).filter(([, v]) => v === area).map(([k]) => k);
    where.AND.push({ OR: prefixes.map((p) => ({ action: { startsWith: `${p}.` } })) });
  }
  if (q) where.AND.push({ OR: [{ details: { contains: q, mode: 'insensitive' } }, { action: { contains: q, mode: 'insensitive' } }, { actor: { contains: q, mode: 'insensitive' } }] });

  const [rows, people, team] = await Promise.all([
    prisma.activity_log.findMany({ where: where.AND.length ? where : undefined, orderBy: { id: 'desc' }, take: limit }),
    prisma.activity_log.groupBy({ by: ['actor_email'], _count: { _all: true } }),
    prisma.team_members.findMany({ select: { email: true, name: true, role: true } }),
  ]);
  const byEmail = new Map(team.map((t) => [t.email, t]));
  // A blog's publishing failures are hidden once that blog is published or marked done: the
  // problem is over and the repeats only add noise.
  const failedTitles = rows.filter((r) => r.action === 'schedule.failed').map((r) => String(r.details || ''));
  const done = failedTitles.length
    ? await prisma.blog_schedule.findMany({ where: { status: 'published' }, select: { id: true, title: true } })
    : [];
  const resolved = (r: any) =>
    r.action === 'schedule.failed' &&
    done.some((d) => (r.entity_type === 'blog_schedule' && r.entity_id === d.id) || String(r.details || '').startsWith(`${d.title}:`));
  const shown = rows.filter((r) => !resolved(r));
  // Work running right now, shown with a live light at the top of the log.
  const live = runningTimers().map((t) => ({ key: t.key, kind: t.kind, label: t.label, startedAt: new Date(t.startedAt).toISOString() }));
  // Actions end in '.stopped' or '_stopped' ('draft.generation_stopped'), so both separators count.
  const outcome = (action: string) => (/[._](failed|error|held|stopped|interrupted|rejected|denied)$/.test(action) ? 'failed' : /[._](started|asked|queued|resumed|opened)$/.test(action) ? 'started' : 'done');
  return NextResponse.json({
    admin,
    live,
    rows: shown.map((r) => ({
      ...r,
      area: areaOf(r.action),
      what: actionLabel(r.action),
      outcome: outcome(r.action),
      role: r.actor_email ? byEmail.get(r.actor_email)?.role || null : null,
    })),
    people: people
      .filter((p) => p.actor_email && (admin || p.actor_email === me?.email))
      .map((p) => ({ email: p.actor_email, name: byEmail.get(p.actor_email!)?.name || p.actor_email, count: p._count._all }))
      .sort((a, b) => b.count - a.count),
    areas: [...new Set(Object.values(AREAS))].sort(),
  });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

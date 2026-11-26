import { NextRequest, NextResponse } from 'next/server';
import { canDo, forgetLiveAccess } from '@/lib/access';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { OWNER_EMAIL, TESTER_HOURS, can, canBlock, isRole, type Role } from '@/lib/permissions';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// The team list (admin and managers).
export async function GET() {
  // Reading through memberFor ends any tester role whose 48 hours are over.
  const { memberFor } = await import('@/lib/team');
  for (const r of await prisma.team_members.findMany({ where: { role: 'tester' }, select: { email: true } })) await memberFor(r.email);
  const rows = await prisma.team_members.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }] });
  return NextResponse.json(rows.map((r) => ({ ...r, owner: r.email === OWNER_EMAIL })));
}

// { email, name?, role?, blocked? }
//  - add a person or change a role: admin only (the owner always stays admin); giving or removing
//    the admin role needs an admin even when team.roles was granted to someone else
//  - block or unblock: admin (anyone but the owner/admins) or manager (users and analysts)
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase();
  if (!email.endsWith('@' + domain)) return NextResponse.json({ error: `Only @${domain} accounts can sign in.` }, { status: 400 });

  const existing = await prisma.team_members.findUnique({ where: { email } });
  const target: Role = email === OWNER_EMAIL ? 'admin' : isRole(existing?.role) ? (existing!.role as Role) : 'user';
  const data: any = { updated_by: me.name, updated_at: sqlNow() };
  const notes: string[] = [];

  if (body.role !== undefined || !existing) {
    if (!(await canDo(me, 'team.roles'))) return NextResponse.json({ error: 'Only an admin can add people or change roles.' }, { status: 403 });
    const role = body.role ?? 'user';
    if (!isRole(role)) return NextResponse.json({ error: 'Role must be admin, manager, analyst, user or tester.' }, { status: 400 });
    // Giving or taking away the admin role stays with an admin, even for someone granted team.roles.
    if ((role === 'admin' || target === 'admin') && role !== target && me.role !== 'admin') {
      return NextResponse.json({ error: 'Only an admin can give or remove the admin role.' }, { status: 403 });
    }
    if (email === OWNER_EMAIL && role !== 'admin') return NextResponse.json({ error: 'The owner always stays admin.' }, { status: 400 });
    data.role = role;
    // Tester lasts 48 hours from now (giving it again renews it); other roles do not expire.
    data.role_expires_at = role === 'tester' ? new Date(Date.now() + TESTER_HOURS * 3600000).toISOString().slice(0, 19).replace('T', ' ') : null;
    notes.push(role === 'tester' ? `role tester until ${data.role_expires_at} UTC` : `role ${role}`);
  }
  if (body.name !== undefined && (await canDo(me, 'team.roles'))) data.name = String(body.name).slice(0, 100) || null;
  if (body.blocked !== undefined) {
    if (!canBlock(me.role, target, email)) return NextResponse.json({ error: me.role === 'manager' ? 'Managers can block only users and analysts.' : 'This person cannot be blocked.' }, { status: 403 });
    data.blocked = Boolean(body.blocked);
    notes.push(data.blocked ? 'blocked' : 'unblocked');
  }

  // The same person added twice at the same moment (two admins, or a double press): the second add
  // was a unique-key 500. It is refused instead, since its role checks were made for a new person.
  const row = existing
    ? await prisma.team_members.update({ where: { email }, data })
    : await prisma.team_members.create({ data: { email, role: data.role || 'user', role_expires_at: data.role_expires_at || null, name: data.name || null, blocked: Boolean(data.blocked), updated_by: me.name } }).catch((e: any) => {
        if (e?.code === 'P2002') return null;
        throw e;
      });
  if (!row) return NextResponse.json({ error: `${email} was just added by someone else. Reload the Team list to see their role.` }, { status: 409 });
  forgetLiveAccess(email);
  await activity.log('team.changed', { details: `${email}: ${notes.join(', ') || 'updated'}`, actor: me.name });
  return NextResponse.json(row);
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

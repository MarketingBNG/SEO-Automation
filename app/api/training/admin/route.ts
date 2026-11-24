import { NextRequest, NextResponse } from 'next/server';
import prismaClient from '@/lib/prisma';
import * as activity from '@/lib/activity';
import * as settings from '@/lib/settings';
import { getMe } from '@/lib/auth';
import { canDo } from '@/lib/access';
import { canBlock, isRole, isTeam, OWNER_EMAIL, ROLES, type Role } from '@/lib/permissions';
import { listEnrolled, ensureProfile, setActive, setLevel, unblock, isCompanyEmail, clampLevel } from '@/lib/trainingEnroll';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
const prisma: any = prismaClient;

const isManagerOrAdmin = (role: string) => role === 'admin' || role === 'manager';

// The training enrollment list (admin and managers only). Also returns the auto-enroll setting so the
// admin page can show/toggle it.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!isManagerOrAdmin(me.role)) return NextResponse.json({ error: 'Only an admin or a manager can manage enrollment.' }, { status: 403 });
  const autoOn = String((await settings.get('auto_enroll_on_login')) || '').trim() === 'on';
  const autoRoles = String((await settings.get('auto_enroll_roles')) || '').split(',').map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({
    rows: await listEnrolled(),
    autoEnroll: { on: autoOn, roles: autoRoles },
    roles: ROLES.filter((r) => r !== 'admin'),
    canSetRoles: await canDo(me, 'team.roles'),
    role: me.role,
  });
}

// op: enroll | activate | pause | level | unblock | auto-enroll
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!isManagerOrAdmin(me.role)) return NextResponse.json({ error: 'Only an admin or a manager can manage enrollment.' }, { status: 403 });
  const b: any = (await req.json().catch(() => ({}))) || {};
  const op = String(b.op || '');
  const email = String(b.email || '').trim().toLowerCase();

  // Configure the optional auto-enroll on login (admin only).
  if (op === 'auto-enroll') {
    if (!(await canDo(me, 'settings.change'))) return NextResponse.json({ error: 'Only an admin can change this setting.' }, { status: 403 });
    const on = Boolean(b.on);
    const roles = Array.isArray(b.roles) ? b.roles.filter((r: any) => isRole(r) && r !== 'admin') : [];
    await settings.set('auto_enroll_on_login', on ? 'on' : '');
    await settings.set('auto_enroll_roles', roles.join(','));
    await activity.log('training.auto_enroll_setting', { details: `auto-enroll ${on ? 'on' : 'off'}${roles.length ? ` for ${roles.join(', ')}` : ''}`, actor: me.name });
    return NextResponse.json({ ok: true, autoEnroll: { on, roles } });
  }

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const existing = await prisma.team_members.findUnique({ where: { email } });

  if (op === 'enroll') {
    if (!isCompanyEmail(email)) return NextResponse.json({ error: `Only @${(process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase()} accounts can be enrolled.` }, { status: 400 });
    // Adding a new person, or setting/changing their role, grants sign-in access: admin only (team.roles).
    const wantsRole = b.role !== undefined && b.role !== null && String(b.role) !== (existing?.role || '');
    if (!existing || wantsRole) {
      if (!(await canDo(me, 'team.roles'))) return NextResponse.json({ error: 'Only an admin can add a new person or change their role. A manager can enroll someone already on the team.' }, { status: 403 });
      const role: Role = isRole(b.role) ? b.role : 'user';
      if (role === 'admin' || email === OWNER_EMAIL) return NextResponse.json({ error: 'The admin/owner is not a trainee and cannot be enrolled.' }, { status: 400 });
      const team = b.team !== undefined ? String(b.team || '').trim().toLowerCase() : undefined;
      if (team && !isTeam(team)) return NextResponse.json({ error: 'Team must be marketing or automation.' }, { status: 400 });
      await prisma.team_members.upsert({
        where: { email },
        create: { email, name: b.name ? String(b.name).slice(0, 100) : null, role, team: team || null, blocked: false, updated_by: me.name },
        update: { role, ...(team !== undefined ? { team: team || null } : {}), ...(b.name ? { name: String(b.name).slice(0, 100) } : {}) },
      });
      await activity.log('team.changed', { details: `${email}: role ${role} (via enrollment)`, actor: me.name });
    } else if (existing.role === 'admin') {
      return NextResponse.json({ error: 'The admin is not a trainee and cannot be enrolled.' }, { status: 400 });
    }
    const { created, profile } = await ensureProfile(email, { level: b.level, name: b.name || existing?.name || null, actor: me.name });
    return NextResponse.json({ ok: true, created, level: profile.level, active: Boolean(profile.active) });
  }

  // From here the person must be an existing non-admin team member.
  if (!existing) return NextResponse.json({ error: 'This person is not on the team. Use Enroll to add them.' }, { status: 404 });
  if (existing.role === 'admin') return NextResponse.json({ error: 'The admin is not a trainee.' }, { status: 400 });

  if (op === 'activate') { await setActive(email, true, me.name); return NextResponse.json({ ok: true }); }
  if (op === 'pause') { await setActive(email, false, me.name); return NextResponse.json({ ok: true }); }
  if (op === 'level') {
    const level = clampLevel(b.level);
    if (!(await prisma.training_profiles.findUnique({ where: { email } }))) return NextResponse.json({ error: 'Enroll this person first.' }, { status: 404 });
    await setLevel(email, level, me.name);
    return NextResponse.json({ ok: true, level });
  }
  if (op === 'unblock') {
    if (!canBlock(me.role, existing.role as Role, email)) return NextResponse.json({ error: me.role === 'manager' ? 'Managers can unblock only users and analysts.' : 'This person cannot be unblocked.' }, { status: 403 });
    await unblock(email, me.name);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'op must be enroll, activate, pause, level, unblock or auto-enroll' }, { status: 400 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

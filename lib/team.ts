// Team members and their roles. Only people the admin has added (Team page) can sign in; a company
// Google account alone is not enough. The owner (ADMIN_EMAIL, default abhuday@usaindiacfo.com) is
// always an unblocked admin and is added on first sign-in.
import prisma from './prisma';
import { OWNER_EMAIL, isRole, type Role } from './permissions';
import { sqlNow } from './time';

export type Member = { email: string; name: string | null; role: Role; blocked: boolean; roleExpiresAt: string | null };

// True when this email may sign in: the owner, or someone already on the team list.
export async function isMember(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if (e === OWNER_EMAIL) return true;
  return Boolean(await prisma.team_members.findUnique({ where: { email: e }, select: { email: true } }));
}

// The person's team entry, or null when the admin has not added them.
export async function memberFor(email: string, name?: string | null): Promise<Member | null> {
  const e = email.toLowerCase();
  const owner = e === OWNER_EMAIL;
  let row = await prisma.team_members.findUnique({ where: { email: e } });
  if (!row) {
    if (!owner) return null;
    row = await prisma.team_members.create({ data: { email: e, name: name || null, role: 'admin' } }).catch(() => prisma.team_members.findUnique({ where: { email: e } }) as any);
  } else if (name && !row.name) {
    row = await prisma.team_members.update({ where: { email: e }, data: { name } });
  }
  // The tester role ends after 48 hours: the person becomes a user again.
  if (row && row.role === 'tester' && row.role_expires_at && row.role_expires_at <= sqlNow()) {
    row = await prisma.team_members.update({ where: { email: e }, data: { role: 'user', role_expires_at: null, updated_by: 'Automatic (tester role ended after 48 hours)', updated_at: sqlNow() } });
    await prisma.activity_log.create({ data: { action: 'team.tester_expired', details: `${e}: tester role ended after 48 hours, now a user`, actor: 'Automatic', source: 'automatic' } }).catch(() => {});
  }
  const role: Role = owner ? 'admin' : isRole(row?.role) ? (row!.role as Role) : 'user';
  return { email: e, name: row?.name || name || null, role, blocked: owner ? false : Boolean(row?.blocked), roleExpiresAt: role === 'tester' ? row?.role_expires_at || null : null };
}

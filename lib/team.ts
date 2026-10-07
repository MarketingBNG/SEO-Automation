// Team members and their roles. Everyone with a company Google account can sign in; new people
// start as "user". The owner (ADMIN_EMAIL, default abhuday@usaindiacfo.com) is always an unblocked admin.
import prisma from './prisma';
import { OWNER_EMAIL, isRole, type Role } from './permissions';
import { sqlNow } from './time';

export type Member = { email: string; name: string | null; role: Role; blocked: boolean; roleExpiresAt: string | null };

export async function memberFor(email: string, name?: string | null): Promise<Member> {
  const e = email.toLowerCase();
  const owner = e === OWNER_EMAIL;
  let row = await prisma.team_members.findUnique({ where: { email: e } });
  if (!row) {
    row = await prisma.team_members.create({ data: { email: e, name: name || null, role: owner ? 'admin' : 'user' } }).catch(() => prisma.team_members.findUnique({ where: { email: e } }) as any);
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

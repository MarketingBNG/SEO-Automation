// SEB device enrollment. The first handoff code (redeemed in Check In) creates a long-lived, revocable
// credential bound to the employee's email AND the Windows user on that device. The Windows launcher
// stores the credential securely (DPAPI, per Windows user) and, on each later launch/reboot, exchanges
// it for a fresh SEB session without a code. The exchange fails (so a code is asked again) when the
// enrollment is revoked, the credential is wrong, or a different Windows user presents it.
import crypto from 'crypto';
import prismaClient from './prisma';
import { sqlNow } from './time';

const prisma: any = prismaClient;
const rand = (n: number) => crypto.randomBytes(n).toString('base64url');
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Create an enrollment and return the credential ONCE. Any previous active enrollment for the same
// (email, windows user) is revoked first, so one device-user keeps one active credential.
export async function createEnrollment(email: string, windowsUser: string, label?: string): Promise<{ id: string; secret: string }> {
  const who = email.toLowerCase();
  const wu = String(windowsUser);
  await prisma.seb_enrollments.updateMany({ where: { email: who, windows_user: wu, revoked_at: null }, data: { revoked_at: sqlNow() } });
  const id = rand(12);
  const secret = rand(24);
  await prisma.seb_enrollments.create({ data: { id, email: who, windows_user: wu, secret_hash: hash(secret), label: label || null } });
  return { id, secret };
}

// Exchange a stored credential for the employee's email. Returns null (ask for a code again) when the
// enrollment is missing/revoked, the credential is wrong, or the Windows user does not match.
export async function exchangeEnrollment(id: string, secret: string, windowsUser: string): Promise<string | null> {
  if (!id || !secret || !windowsUser) return null;
  const row = await prisma.seb_enrollments.findUnique({ where: { id } });
  if (!row || row.revoked_at) return null; // unlinked / revoked
  if (row.windows_user !== String(windowsUser)) return null; // a different Windows user
  if (row.secret_hash !== hash(secret)) return null; // wrong credential
  await prisma.seb_enrollments.update({ where: { id }, data: { last_used_at: sqlNow() } });
  return row.email;
}

export async function revokeEnrollment(id: string): Promise<number> {
  const r = await prisma.seb_enrollments.updateMany({ where: { id, revoked_at: null }, data: { revoked_at: sqlNow() } });
  return r.count;
}

export async function revokeForEmail(email: string): Promise<number> {
  const r = await prisma.seb_enrollments.updateMany({ where: { email: email.toLowerCase(), revoked_at: null }, data: { revoked_at: sqlNow() } });
  return r.count;
}

// For the admin view (no secrets are returned).
export async function listEnrollments(email?: string) {
  const rows = await prisma.seb_enrollments.findMany({ where: email ? { email: email.toLowerCase() } : {}, orderBy: { created_at: 'desc' }, take: 500 });
  return rows.map((r: any) => ({ id: r.id, email: r.email, windowsUser: r.windows_user, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, active: !r.revoked_at }));
}

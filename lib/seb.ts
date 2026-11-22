// SEB pilot identity: a short-lived, single-use handoff code moves the verified regular-browser
// identity into the locked-down Safe Exam Browser without putting any long-lived secret in a URL.
// The regular browser (signed in with Google) mints a code; the SEB browser redeems it once for an
// httpOnly SEB session cookie. Google OAuth stays entirely in the regular browser.
import crypto from 'crypto';
import prismaClient from './prisma';
import { sqlNow } from './time';

const prisma: any = prismaClient;

export const SEB_COOKIE = 'seb_session';
const HANDOFF_TTL_MS = 5 * 60 * 1000; // 5 minutes, single use
const SESSION_TTL_MS = 10 * 60 * 60 * 1000; // a work day
const rand = (n: number) => crypto.randomBytes(n).toString('base64url');

// Minted in the signed-in regular browser. The code is short-lived and single-use, shown to the person
// to type (or carried in a SEB config), never a durable secret.
export async function mintHandoff(email: string): Promise<{ code: string; expiresAt: string }> {
  const code = rand(9);
  const expiresAt = sqlNow(new Date(Date.now() + HANDOFF_TTL_MS));
  await prisma.seb_handoffs.create({ data: { code, email: email.toLowerCase(), expires_at: expiresAt } });
  return { code, expiresAt };
}

// Redeemed once in SEB. Atomically claims the code (used_at null -> now) so it cannot be reused, and
// only if it has not expired. Returns the email, or null when invalid/expired/already used.
export async function redeemHandoff(code: string): Promise<string | null> {
  if (!code) return null;
  const now = sqlNow();
  const claim = await prisma.seb_handoffs.updateMany({ where: { code, used_at: null, expires_at: { gt: now } }, data: { used_at: now } });
  if (claim.count !== 1) return null;
  const row = await prisma.seb_handoffs.findUnique({ where: { code } });
  return row?.email || null;
}

export async function createSebSession(email: string): Promise<string> {
  const token = rand(24);
  await prisma.seb_sessions.create({ data: { token, email: email.toLowerCase(), expires_at: sqlNow(new Date(Date.now() + SESSION_TTL_MS)) } });
  return token;
}

export async function sebSessionEmail(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const row = await prisma.seb_sessions.findUnique({ where: { token } });
  if (!row || row.expires_at <= sqlNow()) return null;
  return row.email;
}

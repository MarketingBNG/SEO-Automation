// SEB pilot identity: a short-lived, single-use handoff code moves the verified regular-browser
// identity into the locked-down Safe Exam Browser without putting any long-lived secret in a URL.
// The regular browser (signed in with Google) mints a code; the SEB browser redeems it once for an
// httpOnly SEB session cookie. Google OAuth stays entirely in the regular browser.
import crypto from 'crypto';
import prismaClient from './prisma';
import * as settings from './settings';
import { sqlNow } from './time';

const prisma: any = prismaClient;

// The SEB quit link: the dashboard setting seb_quit_url overrides the SEB_QUIT_URL env, else empty.
// Read-only; used by both the no-training auto-quit and the Finished flow.
export async function resolveSebQuitUrl(): Promise<string> {
  return String((await settings.get('seb_quit_url')) || process.env.SEB_QUIT_URL || '');
}

// The launcher runs the gate before opening SEB and launches ONLY for pending training (which the gate
// returns at/after 09:00 IST). Before 09:00 (before-window), on a no-training day, or after completion
// (done) the normal desktop stays available and SEB is not opened.
export const shouldLaunchSeb = (status: string) => status === 'pending';

// A short request id and structured, secret-free timing logs for the SEB startup path. Never pass a
// code, token or cookie value in `extra`: these lines go to the server log.
export const newReqId = () => crypto.randomBytes(5).toString('hex');
export function sebLog(route: string, reqId: string, phase: string, extra?: Record<string, string | number | boolean>): void {
  const parts = [`[seb] ${route} rid=${reqId} ${phase}`];
  if (extra) for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  // eslint-disable-next-line no-console
  console.log(parts.join(' '));
}

// Race a promise against a timeout so one slow/failed dependency cannot stall the whole response. On
// timeout the fallback is returned (the caller logs that it fell back); the slow promise is left to
// settle on its own and its rejection is swallowed so it does not become an unhandled rejection.
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
  });
  // A rejection resolves to the fallback too (slow OR failed), and never surfaces as unhandled.
  const settled = p.then((value) => ({ value, timedOut: false })).catch(() => ({ value: fallback, timedOut: true }));
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

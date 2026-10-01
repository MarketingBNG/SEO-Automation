import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

// OAuth CSRF protection: the auth-url route stores a random `state` in an HttpOnly cookie and adds it
// to the provider URL; the callback only accepts a code whose `state` matches that cookie.
const COOKIE = 'oauth_state';

export function withState(providerUrl: string): { url: string; cookie: string } {
  const state = randomUUID();
  const u = new URL(providerUrl);
  u.searchParams.set('state', state);
  const secure = (process.env.NEXTAUTH_URL || '').startsWith('https://') ? '; Secure' : '';
  return { url: u.toString(), cookie: `${COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=600${secure}` };
}

export function stateIsValid(req: NextRequest): boolean {
  const got = req.nextUrl.searchParams.get('state');
  const want = req.cookies.get(COOKIE)?.value;
  return Boolean(got && want && got === want);
}

export const clearStateCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0`;

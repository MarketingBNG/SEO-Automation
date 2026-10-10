import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { actionFor, can, deniedMessage, isRole } from '@/lib/permissions';

// Replaces the old middleware.js Basic Auth: every page and API route needs a signed-in
// @usaindiacfo.com Google account. Vercel Cron calls carry `Authorization: Bearer CRON_SECRET`.

// /api/site/v1 is the website's content API: it checks its own keys (SITE_API_KEY, SITE_IMPORT_KEY).
const PUBLIC_PREFIXES = ['/api/auth', '/login', '/api/site/v1'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  // Behind Coolify's HTTPS proxy NextAuth sets the __Secure- cookie; tell getToken to look for it.
  const secureCookie =
    (process.env.NEXTAUTH_URL || '').startsWith('https://') || req.headers.get('x-forwarded-proto') === 'https';
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie });
  if (token) {
    // Role rules, checked on the server for every API call (hiding buttons alone is not enough).
    if (pathname.startsWith('/api/')) {
      const role = isRole(token.role) ? token.role : 'user';
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && token.blocked) {
        return NextResponse.json({ error: 'Your account is blocked from taking actions. Ask an admin or your manager.' }, { status: 403 });
      }
      const action = actionFor(req.method, pathname);
      if (action && !can(role, action)) return NextResponse.json({ error: deniedMessage(action) }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?callbackUrl=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Static image files are public, but /api/... (e.g. /api/uploads/x.png) always needs sign-in.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|(?!api/).*\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};

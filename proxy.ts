import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { actionFor, allows, deniedMessage, isRole, roleAccess, type Access, type Grant } from '@/lib/permissions';
import { draftTokenAllows, hasDraftToken } from '@/lib/draftToken';
import { cronAllows, hasCronSecret } from '@/lib/cronSecret';

// Replaces the old middleware.js Basic Auth: every page and API route needs a signed-in
// @usaindiacfo.com Google account. Vercel Cron calls carry `Authorization: Bearer CRON_SECRET`.

// /api/site/v1 is the website's content API: it checks its own keys (SITE_API_KEY, SITE_IMPORT_KEY).
const PUBLIC_PREFIXES = ['/api/auth', '/login', '/api/site/v1'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Claude Code's blog edits (lib/draftToken.ts): read drafts, change title / meta / article only.
  if (hasDraftToken(req)) {
    return draftTokenAllows(req.method, pathname)
      ? NextResponse.next()
      : NextResponse.json({ error: 'The edit token only reads blog drafts and changes their title, meta description and article.' }, { status: 403 });
  }

  // Scheduled jobs: the secret opens only the job routes (GET), not the rest of the API.
  if (hasCronSecret(req)) {
    return cronAllows(req.method, pathname)
      ? NextResponse.next()
      : NextResponse.json({ error: 'The cron secret only runs the scheduled jobs.' }, { status: 403 });
  }

  // Behind Coolify's HTTPS proxy NextAuth sets the __Secure- cookie; tell getToken to look for it.
  const secureCookie =
    (process.env.NEXTAUTH_URL || '').startsWith('https://') || req.headers.get('x-forwarded-proto') === 'https';
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie });
  if (token) {
    // Role rules, checked on the server for every API call (hiding buttons alone is not enough).
    if (pathname.startsWith('/api/')) {
      // Role, block and access as they are now in the database (cached 30 s), not as they were when
      // the cookie was last refreshed. The token's copy is the fallback if the database is down.
      const live = token.email ? await import('@/lib/access').then((a) => a.liveAccessFor(String(token.email))).catch(() => null) : null;
      const role = live ? live.role : isRole(token.role) ? token.role : 'user';
      const blocked = live ? live.blocked : Boolean(token.blocked);
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      const action = actionFor(req.method, pathname);
      // A GET that changes a connection or spends on a paid lookup (settings.change) counts as an action.
      if ((write || action === 'settings.change') && blocked) {
        return NextResponse.json({ error: 'Your account is blocked from taking actions. Ask an admin or your manager.' }, { status: 403 });
      }
      // Access is the role access as the admin set it, plus own grants; without it (an older token
      // when the database is down) the role's standard access applies.
      const access = (live ? live.access : (token.access as Access)) || roleAccess(role);
      const grants = live ? live.grants : (token.grants as Grant[]) || [];
      if (action && role !== 'admin' && !allows(access, grants, action)) return NextResponse.json({ error: deniedMessage(action) }, { status: 403 });
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

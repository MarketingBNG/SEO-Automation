import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { Role } from './permissions';

// Only company Google accounts can sign in. Override with ALLOWED_EMAIL_DOMAIN if the domain changes.
export const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase();

function isAllowed(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}

// A refused sign-in is recorded (at most once an hour per email, so repeated tries cannot flood the log).
async function logDenied(email: string | null | undefined, reason: string) {
  try {
    const { default: prisma } = await import('./prisma');
    const { sqlNowOffset } = await import('./time');
    const who = email ? email.toLowerCase() : null;
    const recent = await prisma.activity_log.findFirst({ where: { action: 'auth.denied', actor_email: who, created_at: { gte: sqlNowOffset('-1 hour') } }, select: { id: true } });
    if (!recent) await prisma.activity_log.create({ data: { action: 'auth.denied', details: `Sign-in refused: ${reason}`, actor: who || 'unknown', actor_email: who, source: 'dashboard' } });
  } catch {}
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      // hd narrows Google's account picker to the company domain; the signIn check below enforces it.
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: 'select_account' } },
    }),
  ],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    async signIn({ profile, user }) {
      const p = profile as { email?: string; email_verified?: boolean } | undefined;
      const email = p?.email || user?.email;
      if (p && p.email_verified === false) return logDenied(email, 'the Google email is not verified').then(() => false);
      if (!isAllowed(email)) return logDenied(email, `not a @${ALLOWED_DOMAIN} account`).then(() => false);
      // Only people the admin has added on the Team page (and the owner) can sign in.
      const { isMember } = await import('./team');
      const ok = await isMember(email!).catch(() => false);
      if (!ok) await logDenied(email, 'not on the Team list');
      return ok;
    },
    // Role and block status travel in the session token, so every request can be checked on the
    // server without a database call. Refreshed whenever the session is read (every minute).
    async jwt({ token, account }) {
      if (account && token.email) {
        const { default: prisma } = await import('./prisma');
        await prisma.activity_log.create({ data: { action: 'auth.signed_in', details: 'Signed in with Google', actor: token.name || token.email, actor_email: token.email.toLowerCase(), source: 'dashboard' } }).catch(() => {});
      }
      if (token.email) {
        const { memberFor } = await import('./team');
        const m = await memberFor(token.email, token.name).catch(() => null);
        if (m) {
          token.role = m.role;
          token.blocked = m.blocked;
          // Pages and actions this person may use (role access plus their own grants).
          const { accessFor } = await import('./access');
          const a = await accessFor(m.email, m.role).catch(() => null);
          if (a) {
            token.access = a.access;
            token.grants = a.grants;
          }
        } else {
          // Not on the team list (for example an old session): no access until the admin adds them.
          token.blocked = true;
          token.access = null;
          token.grants = [];
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token.role as Role) || 'user';
        (session.user as any).blocked = Boolean(token.blocked);
        (session.user as any).access = token.access || null;
        (session.user as any).grants = token.grants || [];
      }
      return session;
    },
  },
};

export function getSession() {
  return getServerSession(authOptions);
}

// Name recorded in activity_log.actor for actions a person takes. Previously hardcoded to one
// person's name; now the signed-in user. Falls back to 'system' outside a request.
export async function getActor(): Promise<string> {
  try {
    const session = await getSession();
    return session?.user?.name || session?.user?.email || 'system';
  } catch {
    return 'system';
  }
}

// The signed-in person's email, role and block status (from the session token).
export async function getMe(): Promise<{ email: string; name: string; role: Role; blocked: boolean } | null> {
  try {
    const session: any = await getSession();
    if (!session?.user?.email) return null;
    return { email: String(session.user.email).toLowerCase(), name: session.user.name || session.user.email, role: session.user.role || 'user', blocked: Boolean(session.user.blocked) };
  } catch {
    return null;
  }
}

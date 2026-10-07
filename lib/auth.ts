import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { Role } from './permissions';

// Only company Google accounts can sign in. Override with ALLOWED_EMAIL_DOMAIN if the domain changes.
export const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase();

function isAllowed(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
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
      if (p && p.email_verified === false) return false;
      return isAllowed(p?.email || user?.email);
    },
    // Role and block status travel in the session token, so every request can be checked on the
    // server without a database call. Refreshed whenever the session is read (every minute).
    async jwt({ token }) {
      if (token.email) {
        const { memberFor } = await import('./team');
        const m = await memberFor(token.email, token.name).catch(() => null);
        if (m) {
          token.role = m.role;
          token.blocked = m.blocked;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token.role as Role) || 'user';
        (session.user as any).blocked = Boolean(token.blocked);
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

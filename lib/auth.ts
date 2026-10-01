import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

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

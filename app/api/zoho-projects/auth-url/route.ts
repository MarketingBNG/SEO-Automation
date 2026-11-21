import { getMe } from '@/lib/auth';
import { authUrl } from '@/lib/zohoProjects';
import { withState } from '../../_lib/oauthState';

export const runtime = 'nodejs';

// The signed-in person clicks "Connect Zoho"; this sends them to Zoho's consent screen. A random
// CSRF state is stored in a cookie and echoed back to the callback. The person's identity comes from
// their dashboard session at the callback, not from the URL.
export async function GET() {
  const me = await getMe();
  if (!me) return new Response('Sign in to the dashboard first, then connect Zoho.', { status: 401 });
  try {
    const { url, cookie } = withState(authUrl());
    return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': cookie } });
  } catch (err: any) {
    return new Response(err.message, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

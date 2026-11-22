import { getMe } from '@/lib/auth';
import { authUrl } from '@/lib/zohoPeople';
import { withState } from '../../_lib/oauthState';

export const runtime = 'nodejs';

// The signed-in person connects their own Zoho People (one time). CSRF state in a cookie; identity is
// taken from the dashboard session at the callback, not from the URL.
export async function GET() {
  const me = await getMe();
  if (!me) return new Response('Sign in to the dashboard first, then connect Zoho People.', { status: 401 });
  try {
    const { url, cookie } = withState(authUrl());
    return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': cookie } });
  } catch (err: any) {
    return new Response(err.message, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

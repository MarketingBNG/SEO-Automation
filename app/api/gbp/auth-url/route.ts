import { getAuthUrl } from '@/lib/gbpAuth';

export const runtime = 'nodejs';

// Visiting this in a browser (logged in as whoever manages the Business Profile) redirects
// to Google's consent screen. After clicking "Allow", Google redirects back to
// /api/gbp/oauth-callback, which finishes the connection automatically.
// Old handler accepted any method.
async function handler() {
  try {
    const url = await getAuthUrl();
    return new Response(null, { status: 302, headers: { Location: url } });
  } catch (err: any) {
    return new Response(err.message, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

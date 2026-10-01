import { getAuthUrl } from '@/lib/zohoAuth';

export const runtime = 'nodejs';

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

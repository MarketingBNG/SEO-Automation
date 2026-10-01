import { NextRequest } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/gbpAuth';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { escapeHtml } from '../../_lib/http';

export const runtime = 'nodejs';

const html = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// Old handler accepted any method.
async function handler(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return html(`<h2>Google Business Profile connection failed</h2><p>${escapeHtml(error)}</p><p>You can close this tab.</p>`, 400);
  }

  if (!code) {
    return html('Missing authorization code.', 400);
  }

  try {
    await exchangeCodeForTokens(code);
    await activity.log('gbp.connected', {
      entityType: 'settings',
      details: 'Google Business Profile connected via OAuth',
      actor: await getActor(),
    });
    return html('<h2>Google Business Profile connected ✅</h2><p>You can close this tab and go back to the dashboard.</p>', 200);
  } catch (err: any) {
    return html(`<h2>Connection failed</h2><p>${escapeHtml(err.message)}</p>`, 500);
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

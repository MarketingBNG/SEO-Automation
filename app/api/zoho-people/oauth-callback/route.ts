import { NextRequest } from 'next/server';
import { getMe } from '@/lib/auth';
import { exchangeCode } from '@/lib/zohoPeople';
import { escapeHtml } from '../../_lib/http';
import { stateIsValid, clearStateCookie } from '../../_lib/oauthState';

export const runtime = 'nodejs';

const page = (body: string, status: number) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<div style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${body}</div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearStateCookie } },
  );

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (error) return page(`<h2>Zoho People connect failed</h2><p>${escapeHtml(error)}</p><p>You can close this tab.</p>`, 400);
  if (!code) return page('<h2>Missing code</h2><p>Start again from the dashboard.</p>', 400);
  if (!stateIsValid(req)) return page('<h2>Connect failed</h2><p>The link expired or was not started from this dashboard. Try Connect again.</p>', 400);
  const me = await getMe();
  if (!me) return page('<h2>Sign in first</h2><p>Sign in to the dashboard in this browser, then connect again.</p>', 401);
  try {
    // Zoho adds `accounts-server` (the data center that issued the code) to the callback. Exchange the
    // code there, not at a guessed DC, so a .com-vs-.in mismatch cannot cause "invalid code".
    const accountsServer = req.nextUrl.searchParams.get('accounts-server') || undefined;
    await exchangeCode(code, me.email, accountsServer);
    const home = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '') || '';
    return new Response(null, { status: 302, headers: { Location: `${home}/?zoho_people=connected`, 'Set-Cookie': clearStateCookie } });
  } catch (err: any) {
    return page(`<h2>Connect failed</h2><p>${escapeHtml(err.message)}</p>`, 500);
  }
}

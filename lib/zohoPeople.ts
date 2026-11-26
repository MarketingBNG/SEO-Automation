// Per-employee Zoho People connection and attendance check-in. Each person connects their own Zoho
// People once (OAuth, token under provider "zoho_people:<email>"). The dashboard then records a check-in
// on their behalf without opening Zoho.
//
// Multi-data-center: Zoho accounts live in different data centers (.com US, .in India, .eu, ...). On the
// OAuth callback Zoho tells us which one issued the code via the `accounts-server` query param. We use
// THAT server for the token exchange and store its data center, then use the same DC for token refresh
// and for the People API. This is why an "invalid code" happens when the token exchange is sent to the
// wrong DC: we now follow Zoho's own accounts-server instead of guessing.
import { readTokens, writeTokens, hasTokens } from './tokenStore';
import type { PunchDeps } from './attendance';

const SCOPES = 'ZOHOPEOPLE.attendance.ALL';
const provider = (email: string) => `zoho_people:${email.toLowerCase()}`;

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
const dcTld = (host: string) => { const m = /\.zoho\.([a-z.]+)$/i.exec(host || ''); return m ? m[1].toLowerCase() : ''; };
// Only accept an accounts server that is really a Zoho accounts host (no SSRF to an arbitrary URL).
// An exact allow-list of Zoho data centres: a loose pattern would accept accounts.zoho.attacker.com and
// send the client secret there.
const ZOHO_ACCOUNTS_HOSTS = new Set(['com', 'eu', 'in', 'com.au', 'com.cn', 'jp', 'sa', 'ca', 'uk'].map((tld) => `accounts.zoho.${tld}`));
export const isZohoAccounts = (u: string) => {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' && !x.port && (x.pathname === '/' || x.pathname === '') && !x.search && ZOHO_ACCOUNTS_HOSTS.has(x.hostname.toLowerCase());
  } catch {
    return false;
  }
};
const accountsDefault = () => (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');

export const REQUIRED_ACCESS = {
  module: 'Zoho People, Attendance',
  scope: SCOPES,
  redirectUri: 'ZOHO_PEOPLE_REDIRECT_URI (e.g. https://<dashboard>/api/zoho-people/oauth-callback)',
  note: 'Adding attendance through the API needs the Zoho People attendance API, which may require a specific Zoho People plan. Confirm the plan includes attendance API write before the live pilot.',
};

function cfg() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_PEOPLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET or ZOHO_PEOPLE_REDIRECT_URI is not set.');
  }
  return { clientId, clientSecret, accountsUrl: accountsDefault(), redirectUri };
}

export function authUrl() {
  const { clientId, accountsUrl, redirectUri } = cfg();
  const url = new URL(`${accountsUrl}/oauth/v2/auth`);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

// accountsServer: the `accounts-server` query param Zoho added to the callback (the DC that issued the
// code). We exchange the code THERE, and remember that DC for refresh and the People API.
export async function exchangeCode(code: string, email: string, accountsServer?: string) {
  const { clientId, clientSecret, redirectUri } = cfg();
  const accUrl = (accountsServer && isZohoAccounts(accountsServer)) ? accountsServer.replace(/\/+$/, '') : accountsDefault();
  const res = await fetch(`${accUrl}/oauth/v2/token`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }),
  });
  const tokens: any = await res.json();
  // Only Zoho's error code and text: never echo tokens back to the page or the logs.
  if (!res.ok || tokens.error || !tokens.refresh_token) throw new Error(`Zoho People connect failed: ${String(tokens.error || (tokens.refresh_token ? '' : 'no refresh token returned') || res.status)}${tokens.error_description ? ` (${String(tokens.error_description).slice(0, 200)})` : ''}`);
  tokens.obtained_at = Date.now();
  tokens.dc_accounts = accUrl;                 // where to refresh the token
  tokens.dc = dcTld(hostOf(accUrl)) || 'com';  // which data center (com / in / eu ...) for the People API
  await writeTokens(provider(email), tokens);
  return { ok: true, dc: tokens.dc };
}

export const isConnected = (email: string) => hasTokens(provider(email));

// The People API host for this person, from the data center captured at connect time (fallbacks: the
// ZOHO_PEOPLE_API_URL env, then .com).
async function peopleApiHost(email: string): Promise<string> {
  const tokens: any = await readTokens(provider(email));
  if (tokens?.dc) return `https://people.zoho.${tokens.dc}`;
  return (process.env.ZOHO_PEOPLE_API_URL || 'https://people.zoho.com').replace(/\/+$/, '');
}

const maskId = (id: string) => (id ? id.slice(0, 10) + (id.length > 10 ? '…' : '') : '');

// Non-secret diagnostics for the OAuth connect. No secret, token or code is ever returned.
export function diagnostics() {
  const clientId = process.env.ZOHO_CLIENT_ID || '';
  const accountsUrl = accountsDefault();
  const redirectUri = process.env.ZOHO_PEOPLE_REDIRECT_URI || '';
  const nextauth = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
  const expectedRedirectUri = nextauth ? `${nextauth}/api/zoho-people/oauth-callback` : '';
  const accountsHost = hostOf(accountsUrl);
  const redirectHost = hostOf(redirectUri);

  const issues: string[] = [];
  if (!clientId) issues.push('ZOHO_CLIENT_ID is not set.');
  if (!process.env.ZOHO_CLIENT_SECRET) issues.push('ZOHO_CLIENT_SECRET is not set.');
  if (!redirectUri) issues.push('ZOHO_PEOPLE_REDIRECT_URI is not set.');
  if (expectedRedirectUri && redirectUri && redirectUri !== expectedRedirectUri) {
    issues.push(`ZOHO_PEOPLE_REDIRECT_URI (${redirectUri}) does not equal this dashboard's callback (${expectedRedirectUri}). It must ALSO be registered in the Zoho app EXACTLY, character for character.`);
  }
  if (redirectHost && hostOf(nextauth) && redirectHost !== hostOf(nextauth)) {
    issues.push(`The redirect URI host (${redirectHost}) is not this dashboard's host (${hostOf(nextauth)}).`);
  }

  let authorizeUrl = '';
  try { authorizeUrl = authUrl(); } catch { /* cfg incomplete */ }

  return {
    accountsHost, accountsDc: dcTld(accountsHost),
    redirectUri, redirectUriHost: redirectHost,
    expectedRedirectUri, redirectMatchesDashboard: Boolean(expectedRedirectUri) && redirectUri === expectedRedirectUri,
    scope: SCOPES, clientIdMasked: maskId(clientId), clientSecretPresent: Boolean(process.env.ZOHO_CLIENT_SECRET),
    authorizeUrl,
    multiDc: 'The token exchange follows Zoho\'s accounts-server param, so the account\'s real DC is used automatically; the redirect URI must still be registered in the Zoho app EXACTLY.',
    issues,
    hint: 'If connect fails with "invalid code", the account is in a different Zoho DC than the token exchange used - now handled by accounts-server. If "An error occurred" on the consent page, the redirect URI is not registered exactly in the Zoho app.',
  };
}

async function accessToken(email: string): Promise<string> {
  const p = provider(email);
  const tokens: any = await readTokens(p);
  if (!tokens) throw new Error('This person has not connected their Zoho People yet.');
  const ageSeconds = (Date.now() - (tokens.obtained_at || 0)) / 1000;
  if (ageSeconds > (tokens.expires_in || 3600) - 120) {
    const { clientId, clientSecret } = cfg();
    const accUrl = (tokens.dc_accounts && isZohoAccounts(tokens.dc_accounts)) ? tokens.dc_accounts : accountsDefault();
    const res = await fetch(`${accUrl}/oauth/v2/token`, {
      signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token }),
    });
    const refreshed: any = await res.json();
    if (!res.ok || refreshed.error) throw new Error(`Zoho People token refresh failed: ${String(refreshed.error || res.status)}`);
    const merged = { ...tokens, ...refreshed, obtained_at: Date.now() };
    await writeTokens(p, merged);
    return merged.access_token;
  }
  return tokens.access_token;
}

// day YYYY-MM-DD -> dd-MM-yyyy (Zoho People's common date format). Confirm against the real API.
const toDDMMYYYY = (day: string) => { const [y, m, d] = day.split('-'); return `${d}-${m}-${y}`; };

// "dd-MM-yyyy HH:mm:ss" for the check-in: the current IST time when the punch is for today, else 09:00.
export function checkInValue(day: string, now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600000);
  const today = ist.toISOString().slice(0, 10);
  const time = day === today ? ist.toISOString().slice(11, 19) : '09:00:00';
  return `${toDDMMYYYY(day)} ${time}`;
}

// Zoho People reports failures in several shapes, often with HTTP 200: { error }, { errors },
// { response: { status: 1, errors } }, or { response: { result: [{ ...error }] } }.
export function zohoFailed(j: any): boolean {
  if (!j || typeof j !== 'object') return true;
  if (j.error || j.errors) return true;
  const r = j.response;
  if (r && (r.errors || r.status === 1 || r.status === '1' || r.status === 'failure')) return true;
  return false;
}

// Record a check-in in Zoho People. Short timeout so the idempotent layer can reconcile on timeout.
async function punchIn(email: string, day: string): Promise<{ zohoId: string }> {
  const token = await accessToken(email);
  const api = await peopleApiHost(email);
  const url = new URL(`${api}/people/api/attendance`);
  // dateFormat must describe the WHOLE checkIn value (date AND time), otherwise Zoho rejects it. The time
  // is the moment the person pressed Check In (IST), not a fixed 09:00.
  const params = { dateFormat: 'dd-MM-yyyy HH:mm:ss', checkIn: checkInValue(day), emailId: email.toLowerCase() };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || zohoFailed(j)) throw new Error(`Zoho People check-in failed: ${JSON.stringify(j).slice(0, 300)}`);
  const id = j?.result?.id || j?.response?.result?.id || j?.id || `${email}:${day}`;
  return { zohoId: String(id) };
}

// Does Zoho People already have today's check-in for this person? (reconcile after a timeout)
async function findPunch(email: string, day: string): Promise<{ zohoId: string } | null> {
  const token = await accessToken(email);
  const api = await peopleApiHost(email);
  const url = new URL(`${api}/people/api/attendance/getUserReport`);
  const params = { dateFormat: 'dd-MM-yyyy', sdate: toDDMMYYYY(day), edate: toDDMMYYYY(day), emailId: email.toLowerCase() };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000), headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const j: any = await res.json().catch(() => ({}));
  const rows: any[] = j?.result || j?.response?.result || [];
  const hit = Array.isArray(rows) ? rows.find((r) => r?.checkIn || r?.FirstIn || r?.first_in) : null;
  return hit ? { zohoId: String(hit.id || `${email}:${day}`) } : null;
}

// The live deps for lib/attendance.checkIn. Tests pass a mock instead of this.
export const liveDeps: PunchDeps = { punchIn, findPunch };

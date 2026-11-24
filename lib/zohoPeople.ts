// Per-employee Zoho People connection and attendance check-in. Each person connects their own Zoho
// People once (OAuth, token under provider "zoho_people:<email>"). The dashboard then records a check-in
// on their behalf without opening Zoho. Reuses the existing Zoho OAuth app credentials but with the
// People attendance scope and its own redirect URI.
//
// NOT tested against a live Zoho People account. The attendance endpoint shape and the exact scope must
// be confirmed on a real account, and attendance via API may require a specific Zoho People plan (see
// REQUIRED_ACCESS below). These functions are injected into lib/attendance as deps, so all the
// idempotency/retry/reconcile logic is tested with a mock; only the raw HTTP here needs a live check.
import { readTokens, writeTokens, hasTokens } from './tokenStore';
import type { PunchDeps } from './attendance';

// This organisation's Zoho is the US data center (.com). Pin Zoho People to .com so a stale ".in" env
// var or the old ".in" default can never send the consent screen or the attendance API to the wrong
// region, which is the usual cause of "An error occurred" after Accept. Only People is pinned here; Zoho
// Projects (which shares ZOHO_ACCOUNTS_URL) is left untouched.
const toUs = (u: string) => String(u || '').replace(/\.zoho\.in(\b|\/|$)/i, '.zoho.com$1');
const API = toUs(process.env.ZOHO_PEOPLE_API_URL || 'https://people.zoho.com').replace(/\/+$/, '');
// Scope needed to add an attendance entry via API. Confirm the exact scope and plan on a real account.
const SCOPES = 'ZOHOPEOPLE.attendance.ALL';
const provider = (email: string) => `zoho_people:${email.toLowerCase()}`;

// What the admin must confirm on the Zoho side before the live pilot (surfaced by the status route).
export const REQUIRED_ACCESS = {
  module: 'Zoho People, Attendance',
  scope: SCOPES,
  redirectUri: 'ZOHO_PEOPLE_REDIRECT_URI (e.g. https://<dashboard>/api/zoho-people/oauth-callback)',
  note: 'Adding attendance through the API needs the Zoho People attendance API, which may require a specific Zoho People plan. Confirm the plan includes attendance API write before the live pilot.',
};

function cfg() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  // Default to the US accounts domain and pin any ".in" to ".com": this org's Zoho is US, so People never
  // needs the env var set and a stale ".in" cannot break the connect.
  const accountsUrl = toUs(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com');
  const redirectUri = process.env.ZOHO_PEOPLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET or ZOHO_PEOPLE_REDIRECT_URI is not set.');
  }
  return { clientId, clientSecret, accountsUrl: accountsUrl.replace(/\/+$/, ''), redirectUri };
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

export async function exchangeCode(code: string, email: string) {
  const { clientId, clientSecret, accountsUrl, redirectUri } = cfg();
  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }),
  });
  const tokens: any = await res.json();
  if (!res.ok || tokens.error || !tokens.refresh_token) throw new Error(`Zoho People connect failed: ${JSON.stringify(tokens)}`);
  tokens.obtained_at = Date.now();
  await writeTokens(provider(email), tokens);
  return { ok: true };
}

export const isConnected = (email: string) => hasTokens(provider(email));

// Non-secret diagnostics for the OAuth connect: shows exactly what the server would send to Zoho, so a
// redirect-uri or data-center mismatch (the usual cause of Zoho's "An error occurred" after Accept) is
// visible without reading env or the API console. No secret, token or code is ever returned.
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
const dcOf = (host: string) => { const m = /\.zoho\.([a-z.]+)$/.exec(host || ''); return m ? m[1] : (host ? 'unknown' : ''); };
const maskId = (id: string) => (id ? id.slice(0, 10) + (id.length > 10 ? '…' : '') : '');

export function diagnostics() {
  const clientId = process.env.ZOHO_CLIENT_ID || '';
  // The effective accounts URL People will actually use: US default, with any ".in" pinned to ".com".
  const accountsUrl = toUs(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');
  const redirectUri = process.env.ZOHO_PEOPLE_REDIRECT_URI || '';
  const peopleApi = API;
  const nextauth = (process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
  const expectedRedirectUri = nextauth ? `${nextauth}/api/zoho-people/oauth-callback` : '';
  const accountsHost = hostOf(accountsUrl);
  const peopleHost = hostOf(peopleApi);
  const redirectHost = hostOf(redirectUri);
  const accountsDc = dcOf(accountsHost);
  const peopleDc = dcOf(peopleHost);

  const issues: string[] = [];
  if (!clientId) issues.push('ZOHO_CLIENT_ID is not set.');
  if (!process.env.ZOHO_CLIENT_SECRET) issues.push('ZOHO_CLIENT_SECRET is not set.');
  if (!accountsUrl) issues.push('ZOHO_ACCOUNTS_URL is not set.');
  if (!redirectUri) issues.push('ZOHO_PEOPLE_REDIRECT_URI is not set.');
  if (expectedRedirectUri && redirectUri && redirectUri !== expectedRedirectUri) {
    issues.push(`ZOHO_PEOPLE_REDIRECT_URI (${redirectUri}) does not equal this dashboard's callback (${expectedRedirectUri}). It must ALSO be registered in the Zoho app EXACTLY, character for character.`);
  }
  if (accountsDc && peopleDc && accountsDc !== peopleDc) {
    issues.push(`Data-center mismatch: accounts is .${accountsDc} but the People API is .${peopleDc}. They must be the same region, and the Zoho app must be created in that region's API console.`);
  }
  if (redirectHost && accountsHost && hostOf(nextauth) && redirectHost !== hostOf(nextauth)) {
    issues.push(`The redirect URI host (${redirectHost}) is not this dashboard's host (${hostOf(nextauth)}).`);
  }

  let authorizeUrl = '';
  try { authorizeUrl = authUrl(); } catch { /* cfg incomplete; issues above explain */ }

  return {
    accountsHost, accountsDc, peopleApiHost: peopleHost, peopleDc,
    redirectUri, redirectUriHost: redirectHost,
    expectedRedirectUri, redirectMatchesDashboard: Boolean(expectedRedirectUri) && redirectUri === expectedRedirectUri,
    regionConsistent: Boolean(accountsDc) && accountsDc === peopleDc,
    scope: SCOPES, clientIdMasked: maskId(clientId), clientSecretPresent: Boolean(process.env.ZOHO_CLIENT_SECRET),
    authorizeUrl, // the real authorize URL (no state); eyeball redirect_uri / scope / host against the Zoho app
    issues,
    hint: 'Zoho shows "An error occurred" after Accept almost always because redirect_uri is not registered EXACTLY in the app, or the app/account/accounts-URL are in different data centers (.com vs .in). Fix those two and reconnect.',
  };
}

async function accessToken(email: string): Promise<string> {
  const p = provider(email);
  const tokens: any = await readTokens(p);
  if (!tokens) throw new Error('This person has not connected their Zoho People yet.');
  const ageSeconds = (Date.now() - (tokens.obtained_at || 0)) / 1000;
  if (ageSeconds > (tokens.expires_in || 3600) - 120) {
    const { clientId, clientSecret, accountsUrl } = cfg();
    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token }),
    });
    const refreshed: any = await res.json();
    if (!res.ok || refreshed.error) throw new Error(`Zoho People token refresh failed: ${JSON.stringify(refreshed)}`);
    const merged = { ...tokens, ...refreshed, obtained_at: Date.now() };
    await writeTokens(p, merged);
    return merged.access_token;
  }
  return tokens.access_token;
}

// day YYYY-MM-DD -> dd-MM-yyyy (Zoho People's common date format). Confirm against the real API.
const toDDMMYYYY = (day: string) => { const [y, m, d] = day.split('-'); return `${d}-${m}-${y}`; };

// Record a check-in in Zoho People. Short timeout so the idempotent layer can reconcile on timeout.
async function punchIn(email: string, day: string): Promise<{ zohoId: string }> {
  const token = await accessToken(email);
  const url = new URL(`${API}/people/api/attendance`);
  const params = { dateFormat: 'dd-MM-yyyy', checkIn: `${toDDMMYYYY(day)} 09:00:00`, emailId: email.toLowerCase() };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error || j.errors) throw new Error(`Zoho People check-in failed: ${JSON.stringify(j).slice(0, 300)}`);
  const id = j?.result?.id || j?.response?.result?.id || j?.id || `${email}:${day}`;
  return { zohoId: String(id) };
}

// Does Zoho People already have today's check-in for this person? (reconcile after a timeout)
async function findPunch(email: string, day: string): Promise<{ zohoId: string } | null> {
  const token = await accessToken(email);
  const url = new URL(`${API}/people/api/attendance/getUserReport`);
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

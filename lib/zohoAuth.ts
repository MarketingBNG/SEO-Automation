import { readTokens, writeTokens, hasTokens } from './tokenStore';

// PORT NOTE: tokens live in the oauth_tokens table (provider 'zoho') instead of secrets/zoho-tokens.json.
const PROVIDER = 'zoho';

// Read access covers the conversion chain from your playbook: leads, contacts, deals.
const SCOPES = [
  'ZohoCRM.modules.leads.READ',
  'ZohoCRM.modules.contacts.READ',
  'ZohoCRM.modules.deals.READ',
  'ZohoCRM.settings.ALL',
  // The connection test reads /crm/v2/org.
  'ZohoCRM.org.READ',
].join(',');

function getConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  if (!clientId || !clientSecret || !accountsUrl || !redirectUri) {
    throw new Error('ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ACCOUNTS_URL or ZOHO_REDIRECT_URI is not set in .env');
  }
  return { clientId, clientSecret, accountsUrl, redirectUri };
}

function getAuthUrl() {
  const { clientId, accountsUrl, redirectUri } = getConfig();
  const url = new URL(`${accountsUrl}/oauth/v2/auth`);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline'); // needed for a refresh_token
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, accountsUrl, redirectUri } = getConfig();

  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  const tokens = await res.json();
  if (!res.ok || tokens.error) {
    throw new Error(`Zoho token exchange failed: ${JSON.stringify(tokens)}`);
  }

  tokens.obtained_at = Date.now();
  await writeTokens(PROVIDER, tokens);
  return tokens;
}

async function hasStoredTokens() {
  return hasTokens(PROVIDER);
}

async function refreshAccessToken(tokens) {
  const { clientId, clientSecret, accountsUrl } = getConfig();

  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
    }),
  });

  const refreshed = await res.json();
  if (!res.ok || refreshed.error) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(refreshed)}`);
  }

  const merged = { ...tokens, ...refreshed, obtained_at: Date.now() };
  await writeTokens(PROVIDER, merged);
  return merged;
}

// Returns a valid access token, auto-refreshing if the stored one is expired.
// Zoho access tokens last 1 hour (expires_in seconds).
async function getAccessToken() {
  if (!(await hasStoredTokens())) {
    throw new Error('Zoho CRM is not connected yet. Visit /api/zoho/auth-url to start the consent flow.');
  }
  let tokens: any = await readTokens(PROVIDER);

  const ageSeconds = (Date.now() - tokens.obtained_at) / 1000;
  if (ageSeconds > (tokens.expires_in || 3600) - 120) {
    tokens = await refreshAccessToken(tokens);
  }

  return tokens.access_token;
}

export { getAuthUrl, exchangeCodeForTokens, hasStoredTokens, getAccessToken };

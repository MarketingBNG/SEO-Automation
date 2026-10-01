import { google } from 'googleapis';
import { readTokens, writeTokens, hasTokens } from './tokenStore';

// PORT NOTE: tokens live in the oauth_tokens table (provider 'gbp') instead of secrets/gbp-tokens.json.
const PROVIDER = 'gbp';
const SCOPES = ['https://www.googleapis.com/auth/business.manage'];

function getOAuthClient() {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  const redirectUri = process.env.GBP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GBP_CLIENT_ID, GBP_CLIENT_SECRET or GBP_REDIRECT_URI is not set in .env');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // needed to get a refresh_token
    prompt: 'consent', // force re-consent so we always get a refresh_token, even on retry
    scope: SCOPES,
  });
}

async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await writeTokens(PROVIDER, tokens);
  return tokens;
}

async function hasStoredTokens() {
  return hasTokens(PROVIDER);
}

// Returns an authenticated OAuth2 client, auto-refreshing the access token as needed.
async function getAuthenticatedClient() {
  if (!(await hasStoredTokens())) {
    throw new Error('Not connected yet. Visit /api/gbp/auth-url to start the consent flow.');
  }
  const client = getOAuthClient();
  const tokens: any = await readTokens(PROVIDER);
  client.setCredentials(tokens);

  client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    writeTokens(PROVIDER, merged).catch(() => {});
  });

  return client;
}

export { getAuthUrl, exchangeCodeForTokens, hasStoredTokens, getAuthenticatedClient };

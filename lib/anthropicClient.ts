// The one place an Anthropic client is made, with a backup API key.
//
// ANTHROPIC_API_KEY is the main key. When Anthropic answers "credit balance is too low" on it and
// ANTHROPIC_API_KEY_SECONDARY is set, the same request is sent again with the secondary key, so a
// blog or strategy that is half-way through carries on instead of failing. New requests then use the
// secondary key for an hour before the main key is tried again (or at once after a top-up is entered
// in Settings > AI credits). When the secondary key is out of credit too, the error reaches the
// caller as before and AI work pauses (see lib/aiCredits.ts).
import Anthropic from '@anthropic-ai/sdk';

const OUT_OF_CREDIT = /credit balance is too low/i;
const TRY_MAIN_AGAIN_MS = 60 * 60 * 1000;

let mainOutAt = 0;

export const secondaryKeyConfigured = () => !!process.env.ANTHROPIC_API_KEY_SECONDARY;

const mainResting = () => mainOutAt > 0 && Date.now() - mainOutAt < TRY_MAIN_AGAIN_MS;

// Which key new requests use right now (shown in Settings > AI credits).
export function keyInUse(): 'main' | 'secondary' {
  return !process.env.ANTHROPIC_API_KEY || (secondaryKeyConfigured() && mainResting()) ? 'secondary' : 'main';
}

// After a top-up: the next request goes to the main key again.
export function retryMainKey() {
  mainOutAt = 0;
}

export function switchedToSecondary() {
  const first = !mainResting();
  mainOutAt = Date.now();
  if (!first) return;
  const text = 'The main Anthropic API key is out of credit, so the dashboard switched to the secondary key (ANTHROPIC_API_KEY_SECONDARY). It tries the main key again every hour, or as soon as a new balance is entered in Settings > AI credits.';
  console.warn(text);
  import('./activity').then((a) => a.log('ai.key_switched', { details: text })).catch(() => {});
  import('./notify').then((n) => n.notify('AI credits: switched to the secondary API key', text, { action: 'alert.credits_key_switched' })).catch(() => {});
}

function withKey(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('x-api-key', key);
  return { ...init, headers };
}

// `pin`: start on that key (when it is set) instead of the one in use now, for reading a batch that
// key sent (batches belong to the account of the key that made them).
export function anthropicClient(pin?: 'main' | 'secondary'): Anthropic {
  const main = process.env.ANTHROPIC_API_KEY || '';
  const secondary = process.env.ANTHROPIC_API_KEY_SECONDARY || '';
  if (!main && !secondary) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  // Kept per client: a batch made with one key is polled with the same key.
  const kind = pin === 'main' && main ? 'main' : pin === 'secondary' && secondary ? 'secondary' : keyInUse();
  let key = kind === 'secondary' && secondary ? secondary : main;

  const fetchWithBackup = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const res = await fetch(url, withKey(init, key));
    // A client that started on the secondary key (the main one resting or unset) and was refused.
    if (secondary && key === secondary && (res.status === 401 || res.status === 403)) secondaryRejected(res.status);
    if (res.ok || res.status >= 500 || !secondary || key === secondary) return res;
    const body = await res.clone().text().catch(() => '');
    if (!OUT_OF_CREDIT.test(body)) return res;
    switchedToSecondary();
    key = secondary;
    const again = await fetch(url, withKey(init, key));
    if (again.status === 401 || again.status === 403) secondaryRejected(again.status);
    return again;
  };

  const client = new Anthropic({ apiKey: key, fetch: fetchWithBackup });
  // Which key this client is on now (it moves to the secondary one on an out-of-credit answer).
  Object.defineProperty(client, 'keyKind', { get: () => (secondary && key === secondary ? 'secondary' : 'main') });
  return client;
}

export const clientKeyKind = (client: any): 'main' | 'secondary' => (client?.keyKind === 'secondary' ? 'secondary' : 'main');

// The secondary key was refused by Anthropic (wrong or revoked key, for example one that is not an
// sk-ant-api03- API key): said once per hour in the activity log and as an alert.
let rejectedSaidAt = 0;
function secondaryRejected(status: number) {
  if (Date.now() - rejectedSaidAt < TRY_MAIN_AGAIN_MS) return;
  rejectedSaidAt = Date.now();
  const text = `${process.env.ANTHROPIC_API_KEY ? 'The main Anthropic API key is out of credit and the' : 'The'} secondary key (ANTHROPIC_API_KEY_SECONDARY) was refused by Anthropic (HTTP ${status}). Put a valid API key (it starts with sk-ant-api03-) from an account with credit in Coolify and redeploy.`;
  console.warn(text);
  import('./activity').then((a) => a.log('ai.secondary_key_refused', { details: text })).catch(() => {});
  import('./notify').then((n) => n.notify('AI credits: the secondary API key does not work', text, { action: 'alert.credits_secondary_refused' })).catch(() => {});
}

// Whether a key can run a request right now: one tiny request (1 output token on the smallest
// model, a fraction of a cent). Used to resume AI work by itself after a top-up.
export async function keyWorks(which: 'main' | 'secondary'): Promise<boolean> {
  return (await checkKey(which)).ok;
}

// What Anthropic answers for one key right now, for Settings > AI credits ("Test both keys"). Shows
// only the last 4 characters of the key, and whether both settings hold the very same key.
export async function checkKey(which: 'main' | 'secondary') {
  const k = which === 'main' ? process.env.ANTHROPIC_API_KEY : process.env.ANTHROPIC_API_KEY_SECONDARY;
  if (!k) return { which, configured: false, ok: false, message: 'Not set on the server.' };
  const info = { which, configured: true, ending: k.slice(-4), apiKeyFormat: k.startsWith('sk-ant-api'), sameAsMain: which === 'secondary' && k === process.env.ANTHROPIC_API_KEY };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.PROBE_MODEL || 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
    signal: AbortSignal.timeout(30000),
  }).catch((e: any) => ({ ok: false, status: 0, text: async () => e.message }) as any);
  if (res.ok) return { ...info, ok: true, message: 'Works.' };
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    message = JSON.parse(body)?.error?.message || body;
  } catch {}
  return { ...info, ok: false, status: res.status, message: String(message).slice(0, 300) };
}

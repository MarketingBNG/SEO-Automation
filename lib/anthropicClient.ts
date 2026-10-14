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

function switchedToSecondary() {
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

export function anthropicClient(): Anthropic {
  const main = process.env.ANTHROPIC_API_KEY || '';
  const secondary = process.env.ANTHROPIC_API_KEY_SECONDARY || '';
  if (!main && !secondary) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  // Kept per client: a batch made with one key is polled with the same key.
  let key = keyInUse() === 'secondary' && secondary ? secondary : main;

  const fetchWithBackup = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const res = await fetch(url, withKey(init, key));
    if (res.ok || res.status >= 500 || !secondary || key === secondary) return res;
    const body = await res.clone().text().catch(() => '');
    if (!OUT_OF_CREDIT.test(body)) return res;
    switchedToSecondary();
    key = secondary;
    return fetch(url, withKey(init, key));
  };

  return new Anthropic({ apiKey: key, fetch: fetchWithBackup });
}

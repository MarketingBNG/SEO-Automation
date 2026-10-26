// Design skills from the Social Media dashboard. That dashboard watches the YouTube learning library with Gemini and
// builds the creative skills; this one reads the design, typography, colour and light skills for its blog banners
// (lib/coverPhoto.ts). Read-only and signed: X-Share-Timestamp (unix seconds) and X-Share-Signature =
// HMAC-SHA256(SOCIAL_SKILLS_SECRET, timestamp + "\n" + raw JSON body); the Social dashboard holds the same value as
// SKILLS_SHARE_SECRET. Kept for an hour; '' when it is not set up or cannot be reached (a banner never waits on it).
import crypto from 'crypto';

const BASE = () => (process.env.SOCIAL_DASHBOARD_URL || 'https://social.usaindiacfo.us').replace(/\/+$/, '');
let cache: { at: number; ttl: number; text: string } | null = null;

export async function designSkills(): Promise<string> {
  const secret = process.env.SOCIAL_SKILLS_SECRET || '';
  if (secret.length < 32) return '';
  if (cache && Date.now() - cache.at < cache.ttl) return cache.text;
  try {
    const body = JSON.stringify({ action: 'skills', maxChars: 3500, nonce: crypto.randomBytes(12).toString('hex') });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', secret).update(`${ts}\n${body}`).digest('hex');
    const res = await fetch(`${BASE()}/api/share/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Share-Timestamp': ts, 'X-Share-Signature': sig },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await res.json().catch(() => null);
    const text = res.ok ? String(j?.text || '') : '';
    cache = { at: Date.now(), ttl: 60 * 60000, text };
    return text;
  } catch {
    cache = { at: Date.now(), ttl: 10 * 60000, text: '' };
    return '';
  }
}

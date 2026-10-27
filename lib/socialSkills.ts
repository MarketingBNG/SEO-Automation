// Design skills from the Social Media dashboard. That dashboard watches the YouTube learning library with Gemini and
// builds the creative skills; this one reads the design, typography, colour and light skills for its blog banners
// (lib/coverPhoto.ts), and can ask for another set by name when a feature needs it ('poster', 'thumbnail', 'motion',
// 'script'). Read-only and signed: X-Share-Timestamp (unix seconds) and X-Share-Signature =
// HMAC-SHA256(SOCIAL_SKILLS_SECRET, timestamp + "\n" + raw JSON body); the Social dashboard holds the same value as
// SKILLS_SHARE_SECRET. Kept for an hour; '' when it is not set up or cannot be reached (a banner never waits on it).
import crypto from 'crypto';

const BASE = () => (process.env.SOCIAL_DASHBOARD_URL || 'https://social.usaindiacfo.us').replace(/\/+$/, '');
const cache = new Map<string, { at: number; ttl: number; text: string }>();

export async function designSkills(set = 'banner'): Promise<string> {
  const secret = process.env.SOCIAL_SKILLS_SECRET || '';
  if (secret.length < 32) return '';
  const hit = cache.get(set);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.text;
  try {
    const body = JSON.stringify({ action: 'skills', set, maxChars: 3500, nonce: crypto.randomBytes(12).toString('hex') });
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
    cache.set(set, { at: Date.now(), ttl: res.ok ? 60 * 60000 : 10 * 60000, text });
    return text;
  } catch {
    cache.set(set, { at: Date.now(), ttl: 10 * 60000, text: '' });
    return '';
  }
}

// Blog banners are made in the Social Media dashboard (its design engine, the website's look with the square grid; they
// are listed on its SEO banners page). The photo is sent cropped to 1200x630; the finished JPEG comes back. null when the
// link is not set up or anything fails, so the banner is then made here as before (lib/cover.ts).
export async function socialBanner(title: string, gold: string | undefined, photo: Buffer, ref: string): Promise<Buffer | null> {
  const secret = process.env.SOCIAL_SKILLS_SECRET || '';
  if (secret.length < 32) return null;
  try {
    const sharp = (await import('sharp')).default;
    const small = await sharp(photo).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer();
    const body = JSON.stringify({ action: 'banner', title, gold: gold || '', ref, photo: small.toString('base64'), nonce: crypto.randomBytes(12).toString('hex') });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', secret).update(`${ts}\n${body}`).digest('hex');
    const res = await fetch(`${BASE()}/api/share/banner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Share-Timestamp': ts, 'X-Share-Signature': sig },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) return null;
    const out = Buffer.from(await res.arrayBuffer());
    return out.length > 5000 ? out : null;
  } catch {
    return null;
  }
}

// The Social Media dashboard talks to this dashboard's shared "brain" (Learn from YouTube, the creative
// skills, Brand Palette) through /api/partner, server to server. Every request is signed:
//   X-Partner-Timestamp: unix seconds
//   X-Partner-Signature: HMAC-SHA256(PARTNER_SHARED_SECRET, timestamp + "\n" + raw JSON body)
// A request older than 5 minutes, or one already seen, is refused. The same secret is set on the
// Social dashboard as SEO_PARTNER_SECRET.
import crypto from 'crypto';

const WINDOW_S = 300;
const g = globalThis as unknown as { __partnerSeen?: Map<string, number> };
const seen = (g.__partnerSeen ||= new Map<string, number>());

export function verifyPartner(req: Request, raw: string): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.PARTNER_SHARED_SECRET || '';
  if (secret.length < 32) return { ok: false, status: 503, error: 'PARTNER_SHARED_SECRET is not set on the SEO dashboard.' };
  const ts = Number(req.headers.get('x-partner-timestamp'));
  const sig = String(req.headers.get('x-partner-signature') || '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > WINDOW_S) return { ok: false, status: 401, error: 'Request too old or missing its timestamp.' };
  const want = crypto.createHmac('sha256', secret).update(`${ts}\n${raw}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Bad signature.' };
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  if (seen.has(sig)) return { ok: false, status: 401, error: 'This signed request was already used.' };
  seen.set(sig, now + 2 * WINDOW_S * 1000);
  return { ok: true };
}

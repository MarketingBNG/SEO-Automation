// Scheduled jobs (Coolify scheduled tasks, Vercel Cron) call with `Authorization: Bearer <CRON_SECRET>`.
// The secret only opens the scheduled job routes, read-only method (GET), never the rest of the API.
import { sameText } from './draftToken';

const CRON_PATHS = [/^\/api\/cron\/[^/]+$/, /^\/api\/skill\/auto-check$/, /^\/api\/strategy\/auto-check$/];

export function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  return sameText(req.headers.get('authorization') || '', `Bearer ${secret}`);
}

export function cronAllows(method: string, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  return method.toUpperCase() === 'GET' && CRON_PATHS.some((r) => r.test(p));
}

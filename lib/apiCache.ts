// Saved answers from paid data APIs (SE Ranking Data API, SerpHouse, Surfer), so the same question
// asked again within its time limit is not paid for twice. The answer is the same one the API gave,
// so nothing downstream changes. Kept in the settings table (survives restarts and deploys); the
// same question asked at the same moment shares one request.
import { createHash } from 'node:crypto';

const inFlight = new Map<string, Promise<any>>();
// Loaded on first use, so modules that use this can be imported without a database (tests).
const store = () => import('./settings').catch(() => null);

export async function cachedCall<T>(name: string, args: unknown, ttlHours: number, fn: () => Promise<T>): Promise<T> {
  const key = `apicache:${name}:${createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 32)}`;
  const settings = await store();
  try {
    const raw = settings ? await settings.get(key) : null;
    if (raw) {
      const { at, value } = JSON.parse(raw);
      if (Date.now() - at < ttlHours * 3600000) return value as T;
    }
  } catch {}
  const running = inFlight.get(key);
  if (running) return running;
  const p = fn()
    .then(async (value) => {
      if (settings) await settings.set(key, JSON.stringify({ at: Date.now(), value })).catch(() => {});
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Expired answers are never read again unless the same question comes back, so they are deleted
// once they are older than the longest time limit (Surfer, 7 days). Called once a day by the scheduler.
// The saved value starts with {"at":<ms>, so the age is read without parsing the whole answer.
export async function pruneApiCache(now = Date.now()) {
  const { default: prisma } = await import('./prisma');
  const n = await prisma.$executeRaw`DELETE FROM settings WHERE key LIKE 'apicache:%' AND substring(value from '^[{]"at":([0-9]+)')::bigint < ${now - 8 * 24 * 3600000}`;
  // Surfer Content Editors remembered per keyword (lib/surfer.ts): an empty row, or one older than the
  // 7 days an editor is reused (or a failure older than that), is no longer read.
  const m = await prisma.$executeRaw`DELETE FROM settings WHERE key LIKE 'surfer-editor:%' AND (value = '' OR coalesce(substring(value from '"(?:at|failedAt)":([0-9]+)')::bigint, 0) < ${now - 8 * 24 * 3600000})`;
  return n + m;
}

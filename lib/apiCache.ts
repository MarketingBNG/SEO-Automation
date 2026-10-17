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

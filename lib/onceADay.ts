// Once-a-day jobs (topics, training, directories): the day counts as done only when the run ends.
// A run stopped because AI work is paused (credits or Testing mode) leaves the day open, so a later
// tick runs it once AI work is possible again; any other failure still closes the day (it is not
// paid for again every 15 minutes). While a run is going, a marker stops a second one; a marker left
// by a run that a restart cut off goes stale after `staleMinutes`, and the day is run again.
import * as settings from './settings';
import { CreditPausedError, isCreditError } from './aiCredits';

export const waitsForAi = (e: any) => e instanceof CreditPausedError || isCreditError(e);

export async function onceADay<T>(key: string, day: string, fn: () => Promise<T>, staleMinutes = 120): Promise<T | null> {
  if ((await settings.get(key)) === day) return null;
  const runKey = `${key}_running`;
  try {
    const r = JSON.parse((await settings.get(runKey)) || 'null');
    if (r?.day === day && Date.now() - r.at < staleMinutes * 60000) return null;
  } catch {}
  await settings.set(runKey, JSON.stringify({ day, at: Date.now() }));
  try {
    const out = await fn();
    await settings.set(key, day);
    return out;
  } catch (e) {
    if (!waitsForAi(e)) await settings.set(key, day);
    throw e;
  } finally {
    await settings.set(runKey, '').catch(() => {});
  }
}

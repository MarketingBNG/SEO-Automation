// Once-a-day jobs (topics, training, directories): the day counts as done only when the run ends.
// A run stopped because AI work is paused (credits or Testing mode) leaves the day open, so a later
// tick runs it once AI work is possible again; any other failure still closes the day (it is not
// paid for again every 15 minutes). While a run is going, a marker stops a second one, also the next
// day's (a run still waiting on a batch past midnight is not joined); a marker left by a run that a
// restart cut off goes stale after `staleMinutes`, and the day is run again.
import * as settings from './settings';
import { CreditPausedError, isCreditError } from './aiCredits';

export const waitsForAi = (e: any) => e instanceof CreditPausedError || isCreditError(e);

// Thrown by a job when its run was skipped because another run of it (a person's manual press) is
// still going: that run may yet stop for paused AI work or a restart, so the day stays open.
export class AnotherRunGoing extends Error {}

export async function onceADay<T>(key: string, day: string, fn: () => Promise<T>, staleMinutes = 120): Promise<T | null> {
  if ((await settings.get(key)) === day) return null;
  const runKey = `${key}_running`;
  try {
    const r = JSON.parse((await settings.get(runKey)) || 'null');
    if (r?.at && Date.now() - r.at < staleMinutes * 60000) return null;
  } catch {}
  const mine = JSON.stringify({ day, at: Date.now() });
  await settings.set(runKey, mine);
  try {
    const out = await fn();
    await settings.set(key, day);
    return out;
  } catch (e) {
    if (!waitsForAi(e) && !(e instanceof AnotherRunGoing)) await settings.set(key, day);
    throw e;
  } finally {
    // Only this run's own marker is cleared: a later run that started meanwhile keeps its own.
    if ((await settings.get(runKey).catch(() => null)) === mine) await settings.set(runKey, '').catch(() => {});
  }
}

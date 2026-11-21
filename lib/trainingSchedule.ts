// The weekly training rhythm. The normal week is: Monday and Tuesday lessons, Wednesday a test on
// them, Thursday and Friday lessons, Saturday a test on them, Sunday off. Before the pattern starts
// (the first week) it is lessons only, no tests. Surprise tests begin a week after that.
//
// It is controlled by two settings (dates, YYYY-MM-DD), with the defaults below:
//   training_pattern_start  - the Monday the lesson/test pattern begins (before it: lessons only)
//   training_surprise_start - the Monday surprise tests begin
// Set either to an empty string to turn the whole schedule off and go back to a lesson and a test
// every day (this is what the tests do, and the old behaviour).

export const DEFAULT_PATTERN_START = '2026-11-23'; // Monday
export const DEFAULT_SURPRISE_START = '2026-11-30'; // the Monday after
const LESSON_DOW = [1, 2, 4, 5]; // Mon, Tue, Thu, Fri
const TEST_DOW = [3, 6]; // Wed, Sat

const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export type Schedule = { on: boolean; patternStart: string; surpriseStart: string };

export async function getSchedule(): Promise<Schedule> {
  const settings = await import('./settings');
  const patternStart = String((await settings.get('training_pattern_start')) ?? DEFAULT_PATTERN_START).trim();
  const surpriseStart = String((await settings.get('training_surprise_start')) ?? DEFAULT_SURPRISE_START).trim();
  return { on: Boolean(patternStart), patternStart, surpriseStart };
}

// A day lessons are made. Schedule off: every day (old behaviour). Before the pattern: every day but
// Sunday. In the pattern: Monday, Tuesday, Thursday, Friday.
export function isLessonDay(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  const d = dow(day);
  if (d === 0) return false;
  if (day < s.patternStart) return true;
  return LESSON_DOW.includes(d);
}

// A day a test is set. Schedule off: every day. Before the pattern: never. In the pattern: Wednesday
// (on Monday + Tuesday lessons) and Saturday (on Thursday + Friday lessons).
export function isTestDay(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  if (day < s.patternStart) return false;
  return TEST_DOW.includes(dow(day));
}

// Whether surprise tests have started. Schedule off: yes (old behaviour).
export function surpriseOn(day: string, s: Schedule): boolean {
  if (!s.on) return true;
  return Boolean(s.surpriseStart) && day >= s.surpriseStart;
}

// Team training: every morning (09:00 IST) everyone on the team except the admin gets three short
// lessons at their level: Technical knowledge (US-India tax and compliance terms), Know UIC (our
// services, our process and the rules behind each service) and Marketing skills (how to market those
// services, compliance-safe). Associates get the associate lessons; managers get deeper manager
// lessons (strategy, client handling, scoping). The next morning there is a test on them, plus the
// questions answered wrong earlier (they come back two days later until they are right). One
// unannounced weekday a week brings a surprise test mixed from the week's lessons and older misses.
// Levels move with recent scores (adaptiveLevel). After the test, a short game round is built from
// the same lesson. Admins only watch. Lessons are made once per day, track, level and audience and
// shared by everyone there, so AI calls stay few.
import crypto from 'crypto';
import prismaClient from './prisma';
import { goalBlock } from './goal';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { CreditPausedError } from './aiCredits';
import { parseJson } from './strategy/generate';
import { getRecentTranscripts } from './fireflies';
import { istDay, istHour } from './topics';
import { onceADay, waitsForAi, AnotherRunGoing } from './onceADay';
import { sqlNow } from './time';
import { LEVELS, TRACKS, audienceFor, isTrainee, lessonIdsOf, buildGames, cleanVideos, lessonPrompt, questionsFor, writtenFor, scoreGame, systemPrompt, topicFor, type Audience, type GameAnswers, type Track } from './trainingContent';
import { getCatalogue, serviceForDay } from './uicCatalogue';
import { getSchedule, isTestDayFor, isLessonDayFor, isGrandTestDay } from './trainingSchedule';

// Untyped on purpose: the Prisma query types of these many queries push the build's type check past
// its memory limit (see lib/assistant/tabTools.ts). The tests cover the queries.
const prisma: any = prismaClient;

export { LEVELS, audienceFor, isTrainee, lessonIdsOf };
// Lessons and tests are generated at this hour IST, one hour BEFORE the 09:00 device lock window
// (lib/worklog GATE_LOCK_HOUR_IST), so a trainee's training is ready before their laptop locks at 09:00.
export const TRAINING_HOUR_IST = 8;
export const MAX_LEVEL = 5;
// Adaptive levels: over the last WINDOW tests at this level (missed ones count as 0), an average of
// UP_AVG% or more without a falling trend moves the person up; under DOWN_AVG% moves them down.
export const UP_AVG = 80;
export const DOWN_AVG = 50;
export const WINDOW = 3;
export const PASS_PERCENT = UP_AVG;
const REPEAT_AFTER_DAYS = 2;
const MAX_REPEATS_PER_TEST = 5;
const SURPRISE_QUESTIONS = 8;
const GRAND_QUESTIONS = 20; // the monthly grand test is the biggest

// kind 'written' is a typed-answer question: options is empty, answer is -1, and model + points are
// the correct answer and the points a full answer needs, used by the AI to grade the typed reply.
export type Question = { id: string; q: string; options: string[]; answer: number; explain: string; source?: string; track?: Track; topic?: string; repeat?: boolean; kind?: 'mcq' | 'written'; model?: string; points?: string[] };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const g = globalThis as unknown as { __trainingRun?: boolean };


function cleanQuestions(list: any[], prefix: string, max: number, track: Track, topic: string): Question[] {
  return (Array.isArray(list) ? list : [])
    .filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, max)
    .map((q, i) => ({
      id: `${prefix}-${i + 1}`,
      q: String(q.q).slice(0, 700),
      options: q.options.slice(0, 5).map((o: any) => String(o).slice(0, 300)),
      answer: Math.max(0, Math.min(Number(q.answer) || 0, q.options.length - 1)),
      explain: String(q.explain || '').slice(0, 600),
      ...(/^https?:\/\//.test(String(q.source || '')) ? { source: String(q.source).slice(0, 400) } : {}),
      track,
      topic: topic.slice(0, 160),
    }));
}

// Typed questions as stored on the lesson: each becomes a Question with kind 'written' and no options.
function cleanWritten(list: any[], prefix: string, max: number, track: Track, topic: string): Question[] {
  return (Array.isArray(list) ? list : [])
    .filter((q) => q && q.q && (q.model_answer || q.model))
    .slice(0, max)
    .map((q, i) => ({
      id: `${prefix}-w${i + 1}`,
      q: String(q.q).slice(0, 700),
      options: [],
      answer: -1,
      explain: '',
      kind: 'written' as const,
      model: String(q.model_answer || q.model || '').slice(0, 1200),
      points: (Array.isArray(q.key_points) ? q.key_points : (Array.isArray(q.points) ? q.points : [])).slice(0, 6).map((p: any) => String(p).slice(0, 200)),
      track,
      topic: topic.slice(0, 160),
    }));
}

const lessonKey = (day: string, level: number, track: Track, audience: Audience) => ({ day_level_track_audience: { day, level, track, audience } });

// Makes (once) the lesson for a day, level, track and audience. null when a Know UIC lesson has no
// service page it can read today (skipped, and not asked again that day).
// One lesson per key is made at a time on this server: a first visit and the 09:00 run (or two people
// at the same level) asking at once share the one AI call.
const making: Map<string, Promise<any>> = ((globalThis as any).__trainingMaking ||= new Map());
export const MAX_LESSON_FAILURES = 2;

export function makeLesson(day: string, level: number, track: Track = 'technical', audience: Audience = 'associate', ask = callClaude) {
  const key = `${day}:${level}:${track}:${audience}`;
  const running = making.get(key);
  if (running) return running;
  const job = makeLessonOnce(day, level, track, audience, ask).finally(() => making.delete(key));
  making.set(key, job);
  return job;
}

async function makeLessonOnce(day: string, level: number, track: Track, audience: Audience, ask: typeof callClaude) {
  const have = await prisma.training_lessons.findUnique({ where: lessonKey(day, level, track, audience) });
  if (have) return have;
  const skipKey = `training_skip:${day}:${level}:${track}:${audience}`;
  if (await settings.get(skipKey)) return null;
  // A lesson that failed (not because AI work waits) is tried at most twice a day in total for its
  // level, track and audience, whoever asks: after that the day goes without it (nobody is locked).
  const failKey = `training_fail:${day}:${level}:${track}:${audience}`;
  const failures = Number((await settings.get(failKey)) || 0);
  if (failures >= MAX_LESSON_FAILURES) return null;
  let meetings = '';
  if (track === 'technical') {
    try {
      const t: any[] = await getRecentTranscripts(8);
      meetings = t.map((x) => `- ${x.title}: ${x.summary?.short_summary || x.summary?.overview || ''}`.slice(0, 400)).join('\n');
    } catch {
      meetings = '';
    }
  }
  const catalogue = track === 'uic' ? await getCatalogue().catch(() => null) : null;
  const service = catalogue ? serviceForDay(catalogue, day, level) : null;
  const earlier = await prisma.training_lessons.findMany({ where: { level, track, audience }, orderBy: { id: 'desc' }, take: 30, select: { title: true } });
  const prompt = lessonPrompt({
    day,
    level,
    track,
    audience,
    earlier: earlier.map((e) => e.title),
    meetings,
    focus: String((await settings.get('focus_services')) || ''),
    catalogue,
    service,
    technicalTopic: topicFor('technical', day, level),
  });
  let j: any = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try {
      const { text } = (await ask(systemPrompt(goalBlock()), [{ role: 'user', content: prompt }], undefined, { maxUses: 8, effort: 'medium', feature: 'team-training' })) as { text: string };
      j = parseJson(text);
      if (j?.skip) break;
      if (!j?.content_html || !Array.isArray(j.questions) || !j.questions.length) throw new Error('The lesson came back incomplete');
    } catch (e) {
      lastErr = e;
      j = null;
    }
  }
  if (j?.skip) {
    await settings.set(skipKey, String(j.reason || 'no service page could be read').slice(0, 300));
    return null;
  }
  if (!j) {
    if (!waitsForAi(lastErr)) await settings.set(failKey, String(failures + 1));
    throw lastErr || new Error('Could not make the lesson');
  }
  const sources = (Array.isArray(j.sources) ? j.sources : []).filter((s: any) => s && /^https?:\/\//.test(String(s.url || ''))).slice(0, 8).map((s: any) => ({ title: String(s.title || s.url).slice(0, 200), url: String(s.url) }));
  const topic = String(j.topic || (track === 'uic' ? service?.name : topicFor(track, day, level)) || j.title || '').slice(0, 160);
  const questions = cleanQuestions(j.questions, `${day}-L${level}-${track}-${audience}`, questionsFor(track, level), track, topic);
  const written = cleanWritten(j.written, `${day}-L${level}-${track}-${audience}`, writtenFor(track, level), track, topic);
  const extras = { terms: j.terms, steps: j.steps, cases: j.cases, blanks: j.blanks, slides: j.slides, videos: cleanVideos(j.videos), written, service: service ? { name: service.name, url: service.url } : null };
  try {
    return await prisma.training_lessons.create({ data: { day, level, track, audience, topic, title: String(j.title || `Lesson ${day}`).slice(0, 200), content_html: String(j.content_html).replace(/—/g, ', '), sources: JSON.stringify(sources), questions: JSON.stringify(questions), extras: JSON.stringify(extras) } });
  } catch {
    // Made at the same moment by another run: use that one.
    return (await prisma.training_lessons.findUnique({ where: lessonKey(day, level, track, audience) }))!;
  }
}


// Monday of the day's week (YYYY-MM-DD).
export function weekStart(day: string) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
// The one weekday (Mon-Fri) of a week that brings this person's surprise test. Not shown anywhere in
// advance; keyed with the server secret so it cannot be worked out from the email.
export function surpriseWeekday(email: string, day: string, secret = process.env.NEXTAUTH_SECRET || 'training'): number {
  const h = crypto.createHmac('sha256', secret).update(`${email.toLowerCase()}|${weekStart(day)}`).digest();
  return 1 + (h[0] % 5); // 1 = Monday ... 5 = Friday
}
export const isSurpriseDay = (email: string, day: string, secret?: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === surpriseWeekday(email, day, secret);

const seededPick = <T,>(arr: T[], n: number, seed: string): T[] =>
  arr
    .map((v, i) => ({ v, k: crypto.createHash('sha1').update(`${seed}|${i}`).digest().readUInt32BE(0) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.v);

// Gives one person today's tests (daily: yesterday's lessons + wrong answers due again; on their
// surprise day also the surprise test) and today's lessons of every track.
export async function prepareDay(email: string, day: string, role?: string, ask = callClaude) {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  if (!p || !p.active) return;
  const member = await prisma.team_members.findUnique({ where: { email }, select: { role: true, blocked: true } });
  // A blocked person gets no lessons (no AI spent) and is never locked.
  if (member?.blocked) return;
  const r = role || member?.role || 'user';
  if (!isTrainee(r)) return;
  const audience = audienceFor(r);
  // An earlier test left open counts as missed: its questions come back two days from now. So does one
  // left 'marking' by a restart in the middle of its marking (it can no longer be submitted).
  const stale = await prisma.training_tests.findMany({ where: { email, status: { in: ['open', 'marking'] }, day: { lt: day } } });
  for (const t of stale) {
    await prisma.training_tests.update({ where: { id: t.id }, data: { status: 'missed', score: 0 } });
    for (const q of JSON.parse(t.questions) as Question[]) await addMiss(email, q, day);
  }
  const sched = await getSchedule();
  // One day is a lesson OR a test, never both. The monthly grand test (last Tuesday from grand_start)
  // takes over its day. Week 1's tests are Wed + Sat; from week 2 each person gets two unannounced test
  // days a week. Lessons fall on the remaining working days. Sunday is off.
  const grandToday = isGrandTestDay(day, sched);
  const testToday = !grandToday && isTestDayFor(email, day, sched);
  // isLessonDayFor already excludes a person's test days when the schedule is on, and is true every day
  // when the schedule is off (old behaviour: a lesson and a test the same day).
  const lessonToday = !grandToday && isLessonDayFor(email, day, sched);
  const current = lessonIdsOf(p);
  if (testToday && !(await prisma.training_tests.findUnique({ where: { email_day_kind: { email, day, kind: 'daily' } } }))) {
    // The lessons since this person's last test that they have not been tested on yet (all tracks at
    // their level and audience). Test days are now per person and can be more than a week apart, so the
    // window runs from the last test (any kind), not a fixed number of days back. With no prior test, it
    // falls back to the last 8 days. A lesson is still only ever tested once (the filter below).
    const lastTest = await prisma.training_tests.findFirst({ where: { email, day: { lt: day } }, orderBy: { day: 'desc' }, select: { day: true } });
    const since = lastTest ? lastTest.day : addDays(day, -8);
    const recent = await prisma.training_lessons.findMany({ where: { level: p.level, audience, day: { lt: day, gte: since } }, orderBy: [{ day: 'asc' }, { track: 'asc' }] });
    // A lesson is tested once: when a day's new lesson could not be made, the old one is not tested again.
    const fresh: Question[] = [];
    const tested: number[] = [];
    for (const l of recent) {
      const done = await prisma.training_tests.findFirst({ where: { email, OR: [{ lesson_id: l.id }, { lesson_ids: { contains: `,${l.id},` } }] }, select: { id: true } });
      if (done) continue;
      tested.push(l.id);
      fresh.push(...(JSON.parse(l.questions) as Question[]).map((q) => ({ ...q, track: q.track || (l.track as Track), topic: q.topic || l.topic || l.title })));
      // The lesson's typed (written-answer) questions, graded by AI at submit.
      const written = (() => { try { return JSON.parse(l.extras || '{}').written || []; } catch { return []; } })() as Question[];
      fresh.push(...written.map((q) => ({ ...q, kind: 'written' as const, track: q.track || (l.track as Track), topic: q.topic || l.topic || l.title })));
    }
    const misses = await prisma.training_misses.findMany({ where: { email, cleared: false, due_day: { lte: day } }, orderBy: { due_day: 'asc' }, take: MAX_REPEATS_PER_TEST });
    const repeats: Question[] = misses.map((m) => ({ ...(JSON.parse(m.question) as Question), repeat: true }));
    const seen = new Set(fresh.map((q) => q.id));
    const questions = [...fresh, ...repeats.filter((q) => !seen.has(q.id))];
    if (questions.length) {
      await prisma.training_tests.create({ data: { email, day, level: p.level, kind: 'daily', lesson_id: tested[0] || null, lesson_ids: tested.length ? `,${tested.join(',')},` : ',', questions: JSON.stringify(questions), total: questions.length } }).catch(() => {});
    }
  }
  if (grandToday) await prepareGrand(email, day, p.level, audience);

  // Today's lessons, one per track, on a lesson day only. A track that fails (AI paused) is tried again
  // on a later run; the others are kept. On a test day (or Sunday) no new lessons are made and the
  // person keeps the lessons they already have.
  let firstError: any = null;
  if (lessonToday) {
    const lessons = { ...current };
    const have = await prisma.training_lessons.findMany({ where: { id: { in: Object.values(current).filter((x): x is number => Boolean(x)) } }, select: { id: true, day: true } });
    for (const track of TRACKS) {
      const cur = have.find((h) => h.id === current[track]);
      if (cur?.day === day) continue;
      try {
        const l = await makeLesson(day, p.level, track, audience, ask);
        if (l) lessons[track] = l.id;
        else delete lessons[track];
      } catch (e) {
        firstError ||= e;
      }
    }
    await prisma.training_profiles.update({ where: { email }, data: { lesson_ids: JSON.stringify(lessons), lesson_id: lessons.technical ?? p.lesson_id } });
  }
  const { forgetGate } = await import('./trainingGate');
  forgetGate(email);
  if (firstError) throw firstError;
}

// The surprise test: questions from this week's lessons at the person's level and audience, plus up to
// three older misses (not yet due again). Once a week; nothing when the week has no lessons yet.
export async function prepareSurprise(email: string, day: string, level: number, audience: Audience) {
  const monday = weekStart(day);
  if (await prisma.training_tests.findFirst({ where: { email, kind: 'surprise', day: { gte: monday } }, select: { id: true } })) return null;
  const week = await prisma.training_lessons.findMany({ where: { day: { gte: monday, lt: day }, level, audience } });
  const pool: Question[] = week.flatMap((l) => (JSON.parse(l.questions) as Question[]).map((q) => ({ ...q, id: `s-${q.id}`, track: q.track || (l.track as Track), topic: q.topic || l.topic || l.title })));
  if (!pool.length) return null;
  const older = await prisma.training_misses.findMany({ where: { email, cleared: false, due_day: { gt: day } }, orderBy: { due_day: 'asc' }, take: 3 });
  const questions = [...seededPick(pool, SURPRISE_QUESTIONS, `${email}|${day}`), ...older.map((m) => ({ ...(JSON.parse(m.question) as Question), repeat: true }))];
  return prisma.training_tests.create({ data: { email, day, level, kind: 'surprise', questions: JSON.stringify(questions), total: questions.length, lesson_ids: `,${week.map((w) => w.id).join(',')},` } }).catch(() => null);
}

// The monthly grand test: a bigger test on everything learned so far (the person's past lessons at or
// below their level, over the last ~2 months), once a month on the last Tuesday. Nothing when there are
// no past lessons yet.
export async function prepareGrand(email: string, day: string, level: number, audience: Audience) {
  const monthStart = day.slice(0, 7) + '-01';
  if (await prisma.training_tests.findFirst({ where: { email, kind: 'grand', day: { gte: monthStart } }, select: { id: true } })) return null;
  const past = await prisma.training_lessons.findMany({ where: { audience, level: { lte: level }, day: { lt: day, gte: addDays(day, -60) } } });
  const pool: Question[] = past.flatMap((l) => (JSON.parse(l.questions) as Question[]).map((q) => ({ ...q, id: `g-${q.id}`, track: q.track || (l.track as Track), topic: q.topic || l.topic || l.title })));
  if (!pool.length) return null;
  const questions = seededPick(pool, GRAND_QUESTIONS, `${email}|${day}|grand`);
  return prisma.training_tests.create({ data: { email, day, level, kind: 'grand', questions: JSON.stringify(questions), total: questions.length, lesson_ids: `,${past.map((w) => w.id).join(',')},` } }).catch(() => null);
}

async function addMiss(email: string, q: Question, today: string) {
  const clean = { ...q, repeat: undefined };
  const open = await prisma.training_misses.findFirst({ where: { email, cleared: false, question: { contains: `"id":"${q.id}"` } } });
  if (open) await prisma.training_misses.update({ where: { id: open.id }, data: { due_day: addDays(today, REPEAT_AFTER_DAYS), tries: { increment: 1 } } });
  else await prisma.training_misses.create({ data: { email, question: JSON.stringify(clean), due_day: addDays(today, REPEAT_AFTER_DAYS) } });
}

// The questions of a stored test, each with an id of its own: a missing or repeated id (which would
// tie two questions' ticks together) gets one made from the test and the question number.
export function testQuestions(t: { id: number; questions: string }): Question[] {
  const seen = new Set<string>();
  return (JSON.parse(t.questions) as Question[]).map((q, i) => {
    const id = q.id && !seen.has(q.id) ? q.id : `t${t.id}-${i + 1}`;
    seen.add(id);
    return { ...q, id };
  });
}

// The level the recent scores call for. percents: the tests at this level since the last level
// change, newest first (missed = 0).
export function adaptiveLevel(level: number, percents: number[]): { level: number; reason: string | null } {
  const recent = percents.slice(0, WINDOW);
  if (recent.length < 2) return { level, reason: null };
  const avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  const trend = recent[0] - recent[recent.length - 1]; // newest minus oldest
  if (level < MAX_LEVEL && avg >= UP_AVG && trend >= -10) return { level: level + 1, reason: `average ${avg}% over the last ${recent.length} tests (${UP_AVG}% moves up), trend ${trend >= 0 ? '+' : ''}${trend}` };
  if (level > 1 && recent.length >= WINDOW && avg < DOWN_AVG) return { level: level - 1, reason: `average ${avg}% over the last ${recent.length} tests (under ${DOWN_AVG}% moves down)` };
  return { level, reason: null };
}

export async function setLevel(email: string, to: number, reason: string, actor = 'system') {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  if (!p || p.level === to) return;
  await prisma.training_profiles.update({ where: { email }, data: { level: to, streak: 0 } });
  await prisma.training_level_history.create({ data: { email, from_level: p.level, to_level: to, reason: reason.slice(0, 300) } });
  await activity.log('training.level', { details: `${email}: level ${p.level} to ${to} (${reason})`.slice(0, 300), actor });
}

// Scores of the tests taken at the current level since the last level change, newest first.
async function scoresSinceChange(email: string, level: number) {
  const change = await prisma.training_level_history.findFirst({ where: { email }, orderBy: { id: 'desc' }, select: { created_at: true } });
  const tests = await prisma.training_tests.findMany({ where: { email, level, status: { in: ['done', 'missed'] }, kind: { not: 'qa' }, ...(change ? { created_at: { gte: change.created_at } } : {}) }, orderBy: [{ day: 'desc' }, { id: 'desc' }], take: 10, select: { score: true, total: true } });
  return tests.map((t) => Math.round(((t.score || 0) / Math.max(1, t.total)) * 100));
}

// The answer trail, AI-use signals and typed answers the page sends with a submitted test.
export type TestMeta = { log?: unknown; signals?: unknown; written?: Record<string, { text?: string; keystrokes?: number; backspaces?: number; ms?: number; spelling?: number }> };

// The AI grades one typed answer against the model answer and key points. Returns a 0, 0.5 or 1 score
// and a one-line reason. On any failure it returns 0 with a note so the admin can review by hand.
async function gradeWritten(q: Question, answer: string, ask = callClaude): Promise<{ score: number; reason: string }> {
  if (!answer.trim()) return { score: 0, reason: 'No answer written.' };
  const sys = `You grade a trainee's typed answer at USAIndiaCFO (US-India tax and compliance) against a model answer and its key points. Be strict but fair: reward a correct answer in the trainee's own words, do not reward vague answers or text copied from the question. Reply ONLY JSON between ===JSON=== and ===END===: {"score": 0 | 0.5 | 1, "reason": "one short line, and note clear spelling or grammar problems if any"}. 1 = the key points are covered and correct; 0.5 = partly correct or missing a key point; 0 = wrong, empty or off-topic.`;
  const user = `Question: ${q.q}\nModel answer: ${q.model || ''}\nKey points a full answer needs: ${(q.points || []).join('; ')}\nTrainee's typed answer: ${answer.slice(0, 2000)}`;
  try {
    const { text } = (await ask(sys, [{ role: 'user', content: user }], undefined, { maxUses: 1, effort: 'low', feature: 'training-grading' })) as { text: string };
    const j = parseJson(text) || {};
    const raw = Number(j.score);
    const s = [0, 0.5, 1].includes(raw) ? raw : raw >= 0.75 ? 1 : raw >= 0.25 ? 0.5 : 0;
    return { score: s, reason: String(j.reason || '').slice(0, 200) };
  } catch {
    return { score: 0, reason: 'Could not grade automatically; please review by hand.' };
  }
}
const num = (v: unknown, max = 1e9) => Math.max(0, Math.min(Math.round(Number(v) || 0), max));
function cleanLog(log: unknown): { q: number; picks: { o: number; at: number }[] }[] {
  if (!Array.isArray(log)) return [];
  return log.slice(0, 80).map((e: any) => ({
    q: num(e?.q, 999),
    picks: (Array.isArray(e?.picks) ? e.picks : []).slice(0, 25).map((p: any) => ({ o: num(p?.o, 99), at: num(p?.at) })),
  }));
}
// The typed answers and their keystroke stats, bounded and cleaned, for storage and the report.
function cleanWrittenAnswers(w: Record<string, any>): Record<string, { text: string; keystrokes: number; backspaces: number; ms: number; spelling: number }> {
  const out: Record<string, any> = {};
  for (const [id, v] of Object.entries(w || {}).slice(0, 40)) {
    if (!v || typeof v !== 'object') continue;
    out[String(id).slice(0, 80)] = {
      text: String((v as any).text || '').slice(0, 4000),
      keystrokes: num((v as any).keystrokes, 1e5),
      backspaces: num((v as any).backspaces, 1e5),
      ms: num((v as any).ms, 864e5),
      spelling: num((v as any).spelling, 9999),
    };
  }
  return out;
}
function cleanSignals(s: unknown): { pastes: number; switches: number; awayMs: number; ms: number } | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as any;
  return { pastes: num(o.pastes, 9999), switches: num(o.switches, 9999), awayMs: num(o.awayMs, 864e5), ms: num(o.ms, 864e5) };
}

// A person first opened a lesson: the earliest open is kept (read_at - opened_at = time on the lesson).
export async function markLessonOpen(email: string, lessonId: number) {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  const mine = p ? Object.values(lessonIdsOf(p)) : [];
  if (!p || !mine.includes(lessonId)) return { ok: false };
  await prisma.training_lesson_opens.create({ data: { email, lesson_id: lessonId } }).catch(() => {});
  return { ok: true };
}

// A person started a test: the open time is stamped once, so the report can show how long it took.
export async function startTest(email: string, testId: number) {
  const t = await prisma.training_tests.findUnique({ where: { id: testId }, select: { id: true, email: true, opened_at: true, status: true } });
  if (!t || t.email !== email) throw Object.assign(new Error('Test not found'), { status: 404 });
  if (!t.opened_at && t.status === 'open') await prisma.training_tests.update({ where: { id: t.id }, data: { opened_at: sqlNow() } });
  return { ok: true };
}

// The answers picked so far, saved as the person ticks them, for the live test view. Only their own
// open test; bounded and sanitised. Never affects marking (submit sends the real answers).
export async function saveProgress(email: string, testId: number, picked: Record<string, number>) {
  const t = await prisma.training_tests.findUnique({ where: { id: testId }, select: { id: true, email: true, status: true } });
  if (!t || t.email !== email || t.status !== 'open') return { ok: false };
  const clean: Record<number, number> = {};
  for (const [k, v] of Object.entries(picked || {}).slice(0, 100)) {
    const qi = Number(k);
    const oi = Number(v);
    if (Number.isInteger(qi) && qi >= 0 && qi < 100 && Number.isInteger(oi) && oi >= 0 && oi < 20) clean[qi] = oi;
  }
  await prisma.training_tests.update({ where: { id: t.id }, data: { live: JSON.stringify(clean), live_at: sqlNow() } });
  return { ok: true };
}

// Marks a test. Returns the result with the right answers and explanations.
export async function submitTest(email: string, testId: number, answers: Record<string, number>, meta?: TestMeta) {
  const t = await prisma.training_tests.findUnique({ where: { id: testId } });
  if (!t || t.email !== email) throw Object.assign(new Error('Test not found'), { status: 404 });
  // Claimed in one step, so two submits at once (two tabs, a retry) cannot both mark it.
  const claim = await prisma.training_tests.updateMany({ where: { id: t.id, email, status: 'open' }, data: { status: 'marking' } });
  if (claim.count !== 1) throw Object.assign(new Error('This test is already finished'), { status: 409 });
  const today = istDay();
  const questions = testQuestions(t);
  // A QA / disposable test (kind 'qa') runs the real submit + /seb/finish flow but is kept out of all
  // official records: no misses, no level/streak change, no activity log, and it is excluded from every
  // scoring aggregate (results, the team report, the adaptive level). MCQ only, so no AI-graded written
  // answers (no paid calls). It still marks done so the gate opens and SEB quits.
  if (t.kind === 'qa') {
    let qaScore = 0;
    for (const q of questions) if (q.kind !== 'written' && answers?.[q.id] !== undefined && Number(answers[q.id]) === q.answer) qaScore++;
    await prisma.training_tests.update({ where: { id: t.id }, data: { status: 'done', score: qaScore, answers: JSON.stringify(answers || {}), submitted_at: sqlNow() } });
    const { forgetGate } = await import('./trainingGate');
    forgetGate(email);
    return { score: qaScore, total: questions.length, percent: Math.round((qaScore / Math.max(1, questions.length)) * 100), levelUp: false, levelDown: false, kind: 'qa', qa: true, questions, answers, writtenGrades: {}, written: meta?.written || {} };
  }
  let score = 0;
  const writtenGrades: Record<string, { score: number; reason: string }> = {};
  try {
    for (const q of questions) {
      if (q.kind === 'written') {
        // Typed answer: graded by the AI against the model answer and key points.
        const typed = String(meta?.written?.[q.id]?.text || '').trim();
        const g = await gradeWritten(q, typed);
        writtenGrades[q.id] = g;
        score += g.score;
        continue;
      }
      const right = Number(answers?.[q.id]) === q.answer && answers?.[q.id] !== undefined && answers?.[q.id] !== null;
      if (right) {
        await prisma.training_misses.updateMany({ where: { email, cleared: false, question: { contains: `"id":"${q.id}"` } }, data: { cleared: true } });
        score++;
      } else await addMiss(email, q, today);
    }
    score = Math.round(score);
    const log = cleanLog(meta?.log);
    const signals = cleanSignals(meta?.signals);
    const written = meta?.written && typeof meta.written === 'object' ? cleanWrittenAnswers(meta.written) : null;
    await prisma.training_tests.update({ where: { id: t.id }, data: { status: 'done', score, answers: JSON.stringify(answers || {}), submitted_at: sqlNow(), answer_log: log.length ? JSON.stringify(log) : undefined, signals: signals ? JSON.stringify(signals) : undefined, written: written ? JSON.stringify(written) : undefined, written_grades: Object.keys(writtenGrades).length ? JSON.stringify(writtenGrades) : undefined } });
  } catch (e) {
    // Not left half-marked: it can be submitted again.
    await prisma.training_tests.updateMany({ where: { id: t.id, status: 'marking' }, data: { status: 'open' } }).catch(() => {});
    throw e;
  }
  const percent = Math.round((score / Math.max(1, questions.length)) * 100);
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  let levelUp = false;
  let levelDown = false;
  if (p) {
    await prisma.training_profiles.update({ where: { email }, data: { streak: percent >= UP_AVG ? p.streak + 1 : 0 } });
    const next = adaptiveLevel(p.level, await scoresSinceChange(email, p.level));
    if (next.level !== p.level && next.reason) {
      levelUp = next.level > p.level;
      levelDown = next.level < p.level;
      await setLevel(email, next.level, next.reason);
    }
  }
  await activity.log('training.test', { details: `${email}: ${t.kind === 'surprise' ? 'surprise test ' : ''}${score}/${questions.length} (${percent}%)${levelUp ? `, moved up to level ${(p?.level || 1) + 1}` : levelDown ? `, moved down to level ${(p?.level || 2) - 1}` : ''}`, actor: email });
  const { forgetGate } = await import('./trainingGate');
  forgetGate(email);
  return { score, total: questions.length, percent, levelUp, levelDown, kind: t.kind, questions, answers, writtenGrades, written: meta?.written || {} };
}

// "I have read today's lesson": records when (the daily gate needs every one of today's lessons read).
export async function markRead(email: string, lessonId: number) {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  const mine = p ? Object.values(lessonIdsOf(p)) : [];
  if (!p || !mine.includes(lessonId)) throw Object.assign(new Error('This is not one of your lessons.'), { status: 404 });
  const row = await prisma.training_reads.upsert({ where: { email_lesson_id: { email, lesson_id: lessonId } }, create: { email, lesson_id: lessonId, read_at: sqlNow() }, update: {} });
  await activity.log('training.read', { details: `${email} read lesson #${lessonId}`, actor: email });
  const { forgetGate } = await import('./trainingGate');
  forgetGate(email);
  return { readAt: row.read_at };
}

// Days in a row (ending today or yesterday) with a game round played.
export function gameStreak(days: string[], today: string) {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// A game round on a lesson: marked here from the lesson's own game; the best round counts.
export async function playGame(email: string, lessonId: number, answers: GameAnswers) {
  const lesson = await prisma.training_lessons.findUnique({ where: { id: lessonId } });
  if (!lesson) throw Object.assign(new Error('Lesson not found'), { status: 404 });
  const games = buildGames({ id: lesson.id, extras: JSON.parse(lesson.extras || '{}'), questions: lesson.questions });
  const { points, max } = scoreGame(games, answers || {});
  // Points only for the person's own lessons of the day: any other lesson can be played for practice.
  const prof = await prisma.training_profiles.findUnique({ where: { email } });
  const own = prof ? Object.values(lessonIdsOf(prof)).includes(lessonId) : false;
  if (!own || lesson.day !== istDay()) {
    const days = (await prisma.training_games.findMany({ where: { email }, select: { day: true } })).map((r: any) => r.day);
    return { points, max, best: points, totalPoints: prof?.points || 0, streak: gameStreak(days, istDay()), awarded: false, note: 'Practice round: points count only for your own lessons of today.' };
  }
  const before = await prisma.training_games.findUnique({ where: { email_lesson_id: { email, lesson_id: lessonId } } });
  const gain = Math.max(0, points - (before?.points || 0));
  if (!before) await prisma.training_games.create({ data: { email, day: istDay(), lesson_id: lessonId, points, max_points: max } });
  else if (points > before.points) await prisma.training_games.update({ where: { id: before.id }, data: { points } });
  const p = gain ? await prisma.training_profiles.update({ where: { email }, data: { points: { increment: gain } } }).catch(() => null) : await prisma.training_profiles.findUnique({ where: { email } });
  const days = (await prisma.training_games.findMany({ where: { email }, select: { day: true } })).map((r) => r.day);
  return { points, max, best: Math.max(points, before?.points || 0), totalPoints: p?.points || 0, streak: gameStreak(days, istDay()), awarded: true };
}

// Everyone on the team except the admin is in the training (a profile is made for them); blocked
// people are left out (they cannot submit anything).
export async function ensureProfiles() {
  const team = await prisma.team_members.findMany({ where: { blocked: false, role: { not: 'admin' } }, select: { email: true, name: true } });
  for (const m of team) {
    const email = m.email.toLowerCase();
    if (!(await prisma.training_profiles.findUnique({ where: { email } }))) await prisma.training_profiles.create({ data: { email, name: m.name } }).catch(() => {});
  }
}

// Runs the day for everyone in the training. Called by the scheduler and by "Prepare today now".
export async function runTrainingDay(now = new Date()) {
  if (g.__trainingRun) return { skipped: 'Already running' };
  g.__trainingRun = true;
  const day = istDay(now);
  const errors: string[] = [];
  try {
    await ensureProfiles();
    await getCatalogue().catch(() => null); // refreshed once a week
    const team = await prisma.team_members.findMany({ select: { email: true, role: true, blocked: true } });
    const roleOf = new Map<string, { email: string; role: string; blocked: boolean }>(team.map((t: any) => [t.email.toLowerCase(), t]));
    const people = (await prisma.training_profiles.findMany({ where: { active: true } })).filter((p) => {
      const m = roleOf.get(p.email);
      return m && !m.blocked && isTrainee(m.role);
    });
    // A person whose lessons stopped because AI work is paused gets them on a later run that day.
    let waiting = false;
    const failed: string[] = [];
    for (const p of people)
      await prepareDay(p.email, day, roleOf.get(p.email)!.role).catch((e) => {
        errors.push(`${p.email}: ${e.message}`);
        if (waitsForAi(e)) waiting = true;
        else failed.push(`${p.email}: ${e.message}`);
      });
    await settings.set('training_last_run', JSON.stringify({ at: new Date().toISOString(), day, people: people.length, errors }));
    if (failed.length) await activity.log('training.failed', { details: failed.join('; ').slice(0, 300) });
    return { day, people: people.length, errors, waiting };
  } finally {
    g.__trainingRun = false;
  }
}

// Called by the scheduler every 15 minutes: once a day from 08:00 IST (before the 09:00 lock), so the
// day's lessons and tests are ready before a trainee's laptop locks.
export async function trainingTick(now = new Date()) {
  if (istHour(now) < TRAINING_HOUR_IST) return;
  const day = istDay(now);
  // The day counts as done when the run ends; lessons stopped by paused AI work are made later.
  await onceADay('training_last_day', day, async () => {
    const r: any = await runTrainingDay(now);
    // A manual "Prepare today now" is going: this tick did nothing, so the day stays open.
    if (r?.skipped) throw new AnotherRunGoing(r.skipped);
    if (r?.waiting) throw new CreditPausedError('AI work is paused; the remaining lessons are made when it is possible again.');
    return r;
  }).catch((e) => {
    if (!(e instanceof AnotherRunGoing)) console.error('Training day failed:', e.message);
  });
}

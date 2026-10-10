// Associate Training: every morning (09:00 IST) each associate in the training gets a short study
// lesson at their level (the company, its services, the technical side, and the latest news, rules
// and laws, from meeting transcripts and the web). The next morning they get a test on it. A
// question answered wrong comes back two days later until it is right. Two tests in a row at 80% or
// more move the person up a level (1 to 5): longer lessons, more and harder questions. Below that
// they stay at their level.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { parseJson } from './strategy/generate';
import { getRecentTranscripts } from './fireflies';
import { istDay, istHour } from './topics';

export const TRAINING_HOUR_IST = 9;
export const PASS_PERCENT = 80;
export const MAX_LEVEL = 5;
const REPEAT_AFTER_DAYS = 2;
const MAX_REPEATS_PER_TEST = 5;

// How much each level reads and is asked. Level 1 starts small.
export const LEVELS: Record<number, { words: number; questions: number; depth: string }> = {
  1: { words: 300, questions: 5, depth: 'Basics: what the company does, each service in plain words, the key terms a new associate must know.' },
  2: { words: 450, questions: 6, depth: 'Working knowledge: how each service is delivered, documents needed, common client questions, main deadlines.' },
  3: { words: 600, questions: 7, depth: 'Applied: the rules behind the services (IRS, CBDT, FEMA, RBI, MCA, state filings), typical cases and mistakes.' },
  4: { words: 750, questions: 8, depth: 'Advanced: edge cases, how recent rule changes affect clients, comparing options for a client situation.' },
  5: { words: 900, questions: 10, depth: 'Expert: case-style questions that combine several rules, latest law and regulation changes, advising a client end to end.' },
};

export type Question = { id: string; q: string; options: string[]; answer: number; explain: string; repeat?: boolean };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const g = globalThis as unknown as { __trainingRun?: boolean };

const SYSTEM = `You train new associates at USAIndiaCFO (usaindiacfo.com), a cross-border finance, tax and compliance firm serving Indian founders with US companies and NRIs. You write one short, accurate study lesson a day and the test questions on it. Use web search for the latest news, rule changes, laws and deadlines (IRS, CBDT, RBI, FEMA, MCA, SEC, state filings, GST, DTAA). Only state facts you can support; give the source URL for every news or rule item. Never invent figures, dates or rules. Keep it short: an associate reads it in a few minutes.`;

function cleanQuestions(list: any[], prefix: string, max: number): Question[] {
  return (Array.isArray(list) ? list : [])
    .filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
    .slice(0, max)
    .map((q, i) => ({
      id: `${prefix}-${i + 1}`,
      q: String(q.q).slice(0, 500),
      options: q.options.slice(0, 5).map((o: any) => String(o).slice(0, 300)),
      answer: Math.max(0, Math.min(Number(q.answer) || 0, q.options.length - 1)),
      explain: String(q.explain || '').slice(0, 600),
    }));
}

// Makes (once) the lesson for a day and level.
export async function makeLesson(day: string, level: number) {
  const have = await prisma.training_lessons.findUnique({ where: { day_level: { day, level } } });
  if (have) return have;
  const spec = LEVELS[level] || LEVELS[1];
  const focus = String((await settings.get('focus_services')) || 'ITIN, EIN, US company formation for Indians, NRI tax, FEMA compliance, virtual CFO');
  let meetings = '';
  try {
    const t: any[] = await getRecentTranscripts(8);
    meetings = t.map((x) => `- ${x.title}: ${x.summary?.short_summary || x.summary?.overview || ''}`.slice(0, 400)).join('\n');
  } catch {
    meetings = '';
  }
  const earlier = await prisma.training_lessons.findMany({ where: { level }, orderBy: { id: 'desc' }, take: 30, select: { title: true } });
  const prompt = `Today is ${day} (India). Write lesson for level ${level} of 5.
Level ${level}: ${spec.depth}
Services we sell: ${focus}.
What clients asked about in recent meetings (from Fireflies):
${meetings || 'none available'}
Earlier lessons at this level (do not repeat them; build on them): ${earlier.map((e) => e.title).join(' | ') || 'none yet'}.

The lesson mixes: (a) one part about our company or a service and how it works technically, and (b) one current update: news, a rule, law or deadline change from the last 30 days that matters to our clients, found with web search.
Length: about ${spec.words} words, no more. Simple English. Use <h3>, <p>, <ul><li>, <strong>.
Then write ${spec.questions} multiple-choice questions that can be answered from the lesson alone, 4 options each, one correct.
Inside string values never use a double quote: use single quotes, so the JSON stays valid.
Return ONLY JSON between ===JSON=== and ===END===:
{"title":"...","content_html":"<h3>...</h3><p>...</p>","sources":[{"title":"...","url":"https://..."}],"questions":[{"q":"...","options":["...","...","...","..."],"answer":0,"explain":"why this is right, one sentence"}]}`;
  let j: any = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try {
      const { text } = (await callClaude(SYSTEM, [{ role: 'user', content: prompt }], undefined, { maxUses: 5, effort: 'medium', feature: 'training' })) as { text: string };
      j = parseJson(text);
      if (!j?.content_html || !Array.isArray(j.questions) || !j.questions.length) throw new Error('The lesson came back incomplete');
    } catch (e) {
      lastErr = e;
      j = null;
    }
  }
  if (!j) throw lastErr || new Error('Could not make the lesson');
  const sources = (Array.isArray(j.sources) ? j.sources : []).filter((s: any) => s && /^https?:\/\//.test(String(s.url || ''))).slice(0, 6).map((s: any) => ({ title: String(s.title || s.url).slice(0, 200), url: String(s.url) }));
  const questions = cleanQuestions(j.questions, `${day}-L${level}`, spec.questions);
  try {
    return await prisma.training_lessons.create({ data: { day, level, title: String(j.title || `Lesson ${day}`).slice(0, 200), content_html: String(j.content_html), sources: JSON.stringify(sources), questions: JSON.stringify(questions) } });
  } catch {
    // Made at the same moment by another run: use that one.
    return (await prisma.training_lessons.findUnique({ where: { day_level: { day, level } } }))!;
  }
}

// Gives one person today's test (yesterday's lesson + wrong answers due again) and today's lesson.
export async function prepareDay(email: string, day: string) {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  if (!p || !p.active) return;
  // An earlier test left open counts as missed: its questions come back two days from now.
  const stale = await prisma.training_tests.findMany({ where: { email, status: 'open', day: { lt: day } } });
  for (const t of stale) {
    await prisma.training_tests.update({ where: { id: t.id }, data: { status: 'missed', score: 0 } });
    for (const q of JSON.parse(t.questions) as Question[]) await addMiss(email, q, day);
  }
  if (!(await prisma.training_tests.findUnique({ where: { email_day: { email, day } } }))) {
    const lesson = p.lesson_id ? await prisma.training_lessons.findUnique({ where: { id: p.lesson_id } }) : null;
    const fresh: Question[] = lesson && lesson.day < day ? JSON.parse(lesson.questions) : [];
    const misses = await prisma.training_misses.findMany({ where: { email, cleared: false, due_day: { lte: day } }, orderBy: { due_day: 'asc' }, take: MAX_REPEATS_PER_TEST });
    const repeats: Question[] = misses.map((m) => ({ ...(JSON.parse(m.question) as Question), repeat: true }));
    const seen = new Set(fresh.map((q) => q.id));
    const questions = [...fresh, ...repeats.filter((q) => !seen.has(q.id))];
    if (questions.length) await prisma.training_tests.create({ data: { email, day, level: p.level, lesson_id: lesson && lesson.day < day ? lesson.id : null, questions: JSON.stringify(questions), total: questions.length } });
  }
  const current = p.lesson_id ? await prisma.training_lessons.findUnique({ where: { id: p.lesson_id }, select: { day: true } }) : null;
  if (current?.day !== day) {
    const lesson = await makeLesson(day, p.level);
    await prisma.training_profiles.update({ where: { email }, data: { lesson_id: lesson.id } });
  }
}

async function addMiss(email: string, q: Question, today: string) {
  const clean = { ...q, repeat: undefined };
  const open = await prisma.training_misses.findFirst({ where: { email, cleared: false, question: { contains: `"id":"${q.id}"` } } });
  if (open) await prisma.training_misses.update({ where: { id: open.id }, data: { due_day: addDays(today, REPEAT_AFTER_DAYS), tries: { increment: 1 } } });
  else await prisma.training_misses.create({ data: { email, question: JSON.stringify(clean), due_day: addDays(today, REPEAT_AFTER_DAYS) } });
}

// Marks a test. Returns the result with the right answers and explanations.
export async function submitTest(email: string, testId: number, answers: Record<string, number>) {
  const t = await prisma.training_tests.findUnique({ where: { id: testId } });
  if (!t || t.email !== email) throw Object.assign(new Error('Test not found'), { status: 404 });
  if (t.status !== 'open') throw Object.assign(new Error('This test is already finished'), { status: 409 });
  const today = istDay();
  const questions = JSON.parse(t.questions) as Question[];
  let score = 0;
  for (const q of questions) {
    const right = Number(answers?.[q.id]) === q.answer && answers?.[q.id] !== undefined && answers?.[q.id] !== null;
    if (right) {
      score++;
      await prisma.training_misses.updateMany({ where: { email, cleared: false, question: { contains: `"id":"${q.id}"` } }, data: { cleared: true } });
    } else await addMiss(email, q, today);
  }
  await prisma.training_tests.update({ where: { id: t.id }, data: { status: 'done', score, answers: JSON.stringify(answers || {}), submitted_at: new Date().toISOString() } });
  const percent = Math.round((score / Math.max(1, questions.length)) * 100);
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  let levelUp = false;
  if (p) {
    const streak = percent >= PASS_PERCENT ? p.streak + 1 : 0;
    levelUp = streak >= 2 && p.level < MAX_LEVEL;
    await prisma.training_profiles.update({ where: { email }, data: levelUp ? { level: p.level + 1, streak: 0 } : { streak } });
  }
  await activity.log('training.test', { details: `${email}: ${score}/${questions.length} (${percent}%)${levelUp ? `, moved up to level ${(p?.level || 1) + 1}` : ''}`, actor: email });
  return { score, total: questions.length, percent, levelUp, questions, answers };
}

// Runs the day for everyone in the training. Called by the scheduler and by "Prepare today now".
export async function runTrainingDay(now = new Date()) {
  if (g.__trainingRun) return { skipped: 'Already running' };
  g.__trainingRun = true;
  const day = istDay(now);
  const errors: string[] = [];
  try {
    const people = await prisma.training_profiles.findMany({ where: { active: true } });
    for (const p of people) await prepareDay(p.email, day).catch((e) => errors.push(`${p.email}: ${e.message}`));
    await settings.set('training_last_run', JSON.stringify({ at: new Date().toISOString(), day, people: people.length, errors }));
    if (errors.length) await activity.log('training.failed', { details: errors.join('; ').slice(0, 300) });
    return { day, people: people.length, errors };
  } finally {
    g.__trainingRun = false;
  }
}

// Called by the scheduler every 15 minutes: once a day after 09:00 IST.
export async function trainingTick(now = new Date()) {
  if (istHour(now) < TRAINING_HOUR_IST) return;
  const day = istDay(now);
  if ((await settings.get('training_last_day')) === day) return;
  await settings.set('training_last_day', day);
  await runTrainingDay(now).catch((e) => console.error('Training day failed:', e.message));
}

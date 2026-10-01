// Stores every Google "People also ask" question the dashboard sees, with when it was first seen,
// so the monthly report can list new questions to answer in FAQs. Never throws: recording a
// question must not break the brief, audit or report that found it.

import prisma from './prisma';
import { sqlNow, sqlNowOffset, sqlToday } from './time';

const keyOf = (q) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// times_seen counts the days a question was seen, not the searches: one run often sees the same
// question for two related keywords, and that is not Google showing it again.
export async function recordQuestions(keyword, questions) {
  try {
    // PORT NOTE: SQLite ON CONFLICT upsert kept as raw SQL (Postgres syntax): date(last_seen) -> substr(...,1,10),
    // instr -> strpos, datetime('now') -> sqlNow().
    const upsert = (key, question, kw, markets) => {
      const today = sqlToday();
      const now = sqlNow();
      return prisma.$executeRaw`INSERT INTO paa_questions (question_key, question, keyword, markets) VALUES (${key}, ${question}, ${kw}, ${markets})
       ON CONFLICT (question_key) DO UPDATE SET
         times_seen = CASE WHEN substr(paa_questions.last_seen, 1, 10) < ${today} THEN paa_questions.times_seen + 1 ELSE paa_questions.times_seen END,
         last_seen = ${now},
         keyword = excluded.keyword,
         markets = CASE
           WHEN excluded.markets = '' THEN paa_questions.markets
           WHEN paa_questions.markets IS NULL OR paa_questions.markets = '' THEN excluded.markets
           WHEN strpos(',' || paa_questions.markets || ',', ',' || excluded.markets || ',') > 0 THEN paa_questions.markets
           ELSE paa_questions.markets || ',' || excluded.markets END`;
    };
    for (const q of questions || []) {
      const question = typeof q === 'string' ? q : q.question;
      const key = keyOf(question || '');
      if (key.length < 8) continue;
      const markets = typeof q === 'string' ? '' : (q.markets || []).join(',');
      await upsert(key, question, keyword || null, markets);
    }
  } catch (err: any) {
    console.error('questionBank.recordQuestions', err.message);
  }
}

// Google reshuffles "People also ask" often, so (per the research) a question only counts as new
// once it has been seen on at least two days; single sightings are reported separately as
// unconfirmed. newCount is the full count; the list itself is capped.
export async function summary(days = 30) {
  const since = sqlNowOffset(`-${days} days`);
  const total = await prisma.paa_questions.count();
  const confirmedNew = { first_seen: { gte: since }, times_seen: { gte: 2 } };
  const newCount = await prisma.paa_questions.count({ where: confirmedNew });
  const fresh = await prisma.paa_questions.findMany({
    where: confirmedNew,
    select: { question: true, keyword: true, markets: true, first_seen: true, times_seen: true },
    orderBy: [{ times_seen: 'desc' }, { first_seen: 'desc' }],
    take: 40,
  });
  const unconfirmed = await prisma.paa_questions.count({ where: { first_seen: { gte: since }, times_seen: { lt: 2 } } });
  const frequent = await prisma.paa_questions.findMany({
    where: { times_seen: { gt: 1 } },
    select: { question: true, keyword: true, times_seen: true },
    orderBy: [{ times_seen: 'desc' }, { last_seen: 'desc' }],
    take: 15,
  });
  return { total, newCount, newQuestions: fresh, unconfirmedCount: unconfirmed, frequent };
}

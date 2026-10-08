import prisma from './prisma';

export const DEFAULTS: Record<string, string> = {
  max_words: '1600',
  voice_guidelines:
    'Formal, precise, citation-heavy USAIndiaCFO blog voice. Cite specific statutes, sections, forms and agencies by name. No AI filler or hype vocabulary. No em dashes. Lead with the concrete claim.',
  // Byline for every post. Empty means the writer leaves a placeholder that blocks publishing, so a
  // real, credentialed person is always named (never invented).
  byline_author: '',
  byline_reviewer: '',
  cta_text: 'Talk to the USAIndiaCFO cross-border team about your situation',
  cta_url: 'https://usaindiacfo.com/contact-us/',
  // JSON list of { service, match (regex), text, url }; empty means the built-in list in strategy/core.
  service_ctas: '',
  // How many keywords SE Ranking should track (US and India); the weekly job tops the project up.
  tracked_keyword_target: '1500',
  // SE Ranking plan limit for tracked keywords and the slots always kept free.
  seranking_keyword_limit: '5000',
  seranking_keyword_buffer: '500',
  // SE Ranking API credits kept back for blog research; keyword discovery only uses credits above this.
  seranking_reserve_units: '20000',
  // Lessons the dashboard learned from reviews, holds, corrections and results (written weekly).
  writer_lessons: '',
};

export async function get(key) {
  const row = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  if (row) return row.value;
  return DEFAULTS[key] ?? null;
}

// Several keys in one query (for routes that are polled).
export async function getMany(keys: string[]): Promise<Record<string, string | null>> {
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = DEFAULTS[k] ?? null;
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getAll() {
  const rows = await prisma.settings.findMany({ select: { key: true, value: true } });
  const out: Record<string, any> = { ...DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function set(key, value) {
  await prisma.settings.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value) },
  });
}

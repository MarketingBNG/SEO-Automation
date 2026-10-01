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
};

export async function get(key) {
  const row = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  if (row) return row.value;
  return DEFAULTS[key] ?? null;
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

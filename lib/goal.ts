// The dashboard's one goal and its three pillars. Every AI part (strategy, writer, topics, articles,
// training, assistant) reads this, so all the work pulls in the same direction.
export const PILLARS = [
  { key: 'Visibility', meaning: 'Be found: rank in Google and Bing (SEO), win snippets, People Also Ask and AI Overviews (AEO), and be cited by ChatGPT, Perplexity and Gemini (GEO) for every search our buyers make.' },
  { key: 'Traction', meaning: 'Be read and trusted: pull visitors in, keep them reading, bring them back and earn links, shares and brand searches, through blogs that answer real client questions better than anyone.' },
  { key: 'Conversion', meaning: 'Win clients: turn readers into enquiries and paying clients, with a clear next step to the right service page, a strong call to action and proof that builds trust.' },
] as const;

export type Pillar = (typeof PILLARS)[number]['key'];
export const PILLAR_KEYS = PILLARS.map((p) => p.key) as Pillar[];

// The pillar as the AI wrote it, matched to one of the three (case and spelling slack), or null.
export function normalizePillar(v: unknown): Pillar | null {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith('vis')) return 'Visibility';
  if (t.startsWith('trac') || t.startsWith('eng')) return 'Traction';
  if (t.startsWith('conv') || t.startsWith('lead') || t.startsWith('client')) return 'Conversion';
  return null;
}

export const GOAL = 'Grow client conversions for USAIndiaCFO through blogs, SEO, AEO and GEO, by building Visibility, Traction and Conversion together.';

// The block every AI prompt starts from.
export function goalBlock() {
  return `THE DASHBOARD'S GOAL: ${GOAL}
The three pillars (every piece of work must serve at least one, and say which):
${PILLARS.map((p) => `- ${p.key}: ${p.meaning}`).join('\n')}
Rankings and traffic matter because they lead to clients; always keep the path from reader to client in mind.`;
}

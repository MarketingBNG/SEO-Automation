// @ts-nocheck -- reads untyped Fireflies JSON.
// Automatic client-insight review. Each Fireflies meeting summary is cleaned by Claude (names,
// companies, contact details, our prices, quotes and client-specific numbers removed), then a code
// check confirms nothing identifying is left. Clean insights are approved automatically and feed the
// blog writer as real client questions; anything the check is unsure about stays in "pending review".
import prisma from './prisma';
import * as activity from './activity';
import { sqlNow } from './time';
import { callClaude } from './anthropic';
import { getRecentTranscripts } from './fireflies';

// Money amounts and contact details that must never reach a blog via this route.
const MONEY = /(?:\$|usd|inr|cad|aud|gbp|eur|€|£|₹|rs\.?)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:usd|inr|cad|dollars|rupees|lakh|crore)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\+?\d[\d\s().-]{8,}\d/;

// Names that must not survive: participants (from emails) and any name in brackets in the title.
export function identifiers(title = '', participants: string[] = []) {
  const out = new Set<string>();
  for (const p of participants || []) {
    const local = String(p).split('@')[0];
    for (const part of local.split(/[._-]+/)) if (part.length >= 3) out.add(part.toLowerCase());
  }
  for (const m of String(title).matchAll(/\(([^)]+)\)/g)) {
    for (const part of m[1].split(/\s+/)) if (/^[A-Z][a-z]{2,}$/.test(part)) out.add(part.toLowerCase());
  }
  return [...out];
}

// Code check after cleaning. Returns the reasons the text is still unsafe (empty = safe).
export function leftovers(text: string, ids: string[]): string[] {
  const reasons: string[] = [];
  if (MONEY.test(text)) reasons.push('a price or money amount');
  if (EMAIL.test(text)) reasons.push('an email address');
  if (PHONE.test(text)) reasons.push('a phone number');
  const lower = text.toLowerCase();
  for (const id of ids) if (new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) reasons.push(`the name "${id}"`);
  return reasons;
}

async function clean(title: string, overview: string) {
  const system = `You prepare client meeting notes for a content team. Rewrite the notes as general themes a
blog could use: the questions, problems and confusions the client had, and the topics discussed.
REMOVE completely: every person's name, company or brand name of the client, email, phone, address,
city-level location of a person, our prices, fees, quotes, discounts, timelines or promises we gave,
and any number specific to this client's deal. Keep general subject matter (for example "registering
a company in Ontario, Canada", "Canadian corporate tax for a non-resident founder"). Do not add facts.
No em dashes. Return ONLY: ===TITLE===<short generic theme title, no names>===NOTES===<bullet list>===END===`;
  const { text } = await callClaude(system, [{ role: 'user', content: `Title: ${title}\n\nNotes:\n${overview}` }], undefined, { maxUses: 1, effort: 'high' });
  const get = (a, b) => {
    const i = text.indexOf(a);
    if (i < 0) return '';
    const j = text.indexOf(b, i + a.length);
    return text.slice(i + a.length, j < 0 ? undefined : j).trim();
  };
  return { title: get('===TITLE===', '===NOTES==='), overview: get('===NOTES===', '===END===') };
}

// Cleans one insight row and approves it when the code check passes. `cleaner` is injectable for tests.
export async function autoReview(id: number, { participants = [], cleaner = clean } = {}) {
  const row = await prisma.client_insights.findUnique({ where: { id } });
  if (!row || row.status !== 'pending_review') return row;
  const ids = identifiers(row.title || '', participants);
  const cleaned = await cleaner(row.title || '', row.overview || '');
  if (!cleaned.overview) return row;
  const problems = [...new Set([...leftovers(cleaned.overview, ids), ...leftovers(cleaned.title, ids)])];
  const approved = problems.length === 0;
  const updated = await prisma.client_insights.update({
    where: { id },
    data: {
      title: cleaned.title || 'Client meeting themes',
      overview: cleaned.overview,
      // Fireflies action items are internal follow-ups with client details; they never go to the writer.
      action_items: '',
      ...(approved ? { status: 'approved', decided_at: sqlNow() } : {}),
    },
  });
  await activity.log(approved ? 'client_insight.auto_approved' : 'client_insight.needs_review', {
    entityType: 'client_insight',
    entityId: id,
    details: approved ? `Cleaned and approved automatically: ${updated.title}` : `Cleaned, but still contains ${problems.join(', ')}. Left for manual review.`,
  });
  return updated;
}

// Pulls recent Fireflies meetings, adds new ones, and auto-reviews everything still pending.
export async function syncMeetings({ limit = 20, cleaner = clean } = {}) {
  const transcripts = await getRecentTranscripts(limit);
  const out = { added: 0, approved: 0, held: 0 };
  const participantsById = new Map();
  for (const t of transcripts) {
    participantsById.set(t.id, t.participants || []);
    const overview = t.summary?.overview || t.summary?.short_summary || '';
    if (!overview || (await prisma.client_insights.findFirst({ where: { transcript_id: t.id }, select: { id: true } }))) continue;
    await prisma.client_insights.create({
      data: {
        transcript_id: t.id,
        title: t.title || '',
        meeting_date: t.date ? new Date(t.date).toISOString() : '',
        overview,
        action_items: '',
        keywords: JSON.stringify(t.summary?.keywords || []),
        status: 'pending_review',
      },
    });
    out.added++;
  }
  // Items already cleaned once and held for a person are not cleaned again every day.
  const held = new Set((await prisma.activity_log.findMany({ where: { action: 'client_insight.needs_review' }, select: { entity_id: true } })).map((a) => a.entity_id));
  const pending = await prisma.client_insights.findMany({ where: { status: 'pending_review' }, select: { id: true, transcript_id: true } });
  for (const p of pending) {
    if (held.has(p.id)) {
      out.held++;
      continue;
    }
    const r = await autoReview(p.id, { participants: participantsById.get(p.transcript_id) || [], cleaner });
    if (r?.status === 'approved') out.approved++;
    else out.held++;
  }
  return out;
}

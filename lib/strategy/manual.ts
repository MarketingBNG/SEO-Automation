// @ts-nocheck -- reads untyped Claude JSON.
// Tasks of the approved strategy that a person has to do (the dashboard cannot or must not do them
// itself): directory and profile listings (sign-ups, verification, captchas) and technical fixes that
// need a developer. Each task gets a step-by-step guide written for someone who has never done it:
// where to go (verified link), how to sign in, what to fill in, and ready-to-paste text built only from
// facts on usaindiacfo.com. Guides are written on demand (one small Claude call each) and saved.
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { callClaude } from '../anthropic';
import { parseJson } from './generate';
import { publicSite } from '../siteConnector';

const SITE = () => publicSite();

export type ManualTask = {
  kind: 'backlink' | 'fix';
  id: number;
  strategyId: number;
  title: string;
  detail: string;
  date: string | null;
  done: boolean;
  guide: any | null;
  assignedTo: string | null;
  // Kept after the tick, so the team can check the work later: when and who, the listing's address,
  // the sign-up page, and the person's notes.
  doneAt: string | null;
  doneBy: string | null;
  doneByEmail: string | null;
  listingUrl: string | null;
  notes: string | null;
  link: string | null;
};

const parse = (s?: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// The sign-up page a directory task was given with ("Sign up: https://... ."), to open it again.
export const signupLink = (note?: string | null) => (String(note || '').match(/Sign up:\s*(https?:\/\/[^\s]+?)\.?(?:\s|$)/) || [])[1] || null;

// A backlink task a person does (listings, sign-ups) rather than automatic outreach: it is never sent
// back to the automatic queue ("planned"), and it stays listed once done.
export function isPersonTask(row: { status: string; method?: string | null; note?: string | null; done_at?: string | null }) {
  return row.status === 'manual' || Boolean(row.done_at) || /directory|citation/i.test(row.method || '') || (row.status === 'done' && /person/i.test(row.note || ''));
}

// Every task a person has to do, and every one a person has done. Open tasks come from this strategy
// (and open listings from earlier months, which are still to do); done ones stay listed for good,
// from any month, so they can be checked again. Nothing here is ever deleted.
export async function listManualTasks(strategyId: number): Promise<ManualTask[]> {
  const personDone = [{ done_at: { not: null } }, { note: { contains: 'person' } }, { method: { contains: 'irectory', mode: 'insensitive' as const } }, { method: { contains: 'itation', mode: 'insensitive' as const } }];
  const links = await prisma.backlink_tasks.findMany({
    where: { OR: [{ status: 'manual' }, { status: 'done', OR: personDone }] },
    orderBy: [{ send_date: 'asc' }, { id: 'asc' }],
  });
  const fixes = await prisma.technical_fix_tasks.findMany({ where: { OR: [{ strategy_id: { in: [strategyId, 0] }, status: 'manual' }, { status: 'done_by_person' }] }, orderBy: { id: 'asc' } });
  return [
    ...links.map((l) => ({
      kind: 'backlink' as const,
      id: l.id,
      strategyId: l.strategy_id,
      title: `${l.method}: ${l.target_site}`,
      detail: `Link to ${l.our_page || SITE()}. ${/^Done by a person/.test(l.note || '') ? '' : l.note || ''}`.trim(),
      date: l.send_date || null,
      done: l.status === 'done',
      guide: parse(l.guide),
      assignedTo: l.assigned_to || null,
      doneAt: l.status === 'done' ? l.done_at || null : null,
      // Ticked before these were kept: the old note named the person ("Done by a person (Name)").
      doneBy: l.status === 'done' ? l.done_by || (String(l.note || '').match(/^Done by a person \((.+)\)$/) || [])[1] || null : null,
      doneByEmail: l.status === 'done' ? l.done_by_email || null : null,
      listingUrl: l.listing_url || null,
      notes: l.listing_notes || null,
      link: signupLink(l.note) || null,
    })),
    ...fixes.map((f) => ({
      kind: 'fix' as const,
      id: f.id,
      strategyId: f.strategy_id,
      title: `${f.issue} on ${f.url}`,
      detail: `${f.fix}. ${f.result || ''}`.trim(),
      date: f.done_at ? null : f.applied_at || null,
      done: f.status === 'done_by_person',
      guide: parse(f.guide),
      assignedTo: f.assigned_to || null,
      doneAt: f.status === 'done_by_person' ? f.done_at || f.applied_at || null : null,
      doneBy: f.status === 'done_by_person' ? f.done_by || null : null,
      doneByEmail: f.status === 'done_by_person' ? f.done_by_email || null : null,
      listingUrl: f.listing_url || null,
      notes: f.listing_notes || null,
      link: /^https?:\/\//.test(f.url) ? f.url : null,
    })),
  ];
}

export type TaskDetails = { listingUrl?: string | null; notes?: string | null };

// The listing's address and the person's notes, checked: a web address, sensible lengths, and never
// a password (it belongs in the team's password manager, not in the dashboard).
export function cleanDetails(d: TaskDetails | null | undefined): { listing_url?: string | null; listing_notes?: string | null } {
  const out: { listing_url?: string | null; listing_notes?: string | null } = {};
  if (d && d.listingUrl !== undefined) {
    const url = String(d.listingUrl || '').trim();
    if (url && (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url) || url.length > 500)) throw Object.assign(new Error('The listing address must be a full web address starting with https://'), { status: 400 });
    out.listing_url = url || null;
  }
  if (d && d.notes !== undefined) {
    const notes = String(d.notes || '').trim();
    if (notes.length > 2000) throw Object.assign(new Error('Notes can be up to 2,000 characters.'), { status: 400 });
    if (/\b(password|passwd|pwd)\s*[:=-]\s*\S/i.test(notes)) throw Object.assign(new Error('Do not save a password here. Write the login email or username only, and keep the password in the team\'s password manager.'), { status: 400 });
    out.listing_notes = notes || null;
  }
  return out;
}

// Ticks a task done (or not done). The task's own note (sign-up page, why) is kept; who ticked it and
// when, the listing address and the notes are saved with it. "Not done" puts it back on the to-do
// list (never into the automatic outreach queue), keeping the address and notes typed earlier.
export async function setManualDone(kind: string, id: number, done: boolean, actor: string, o: TaskDetails & { email?: string | null } = {}) {
  const details = cleanDetails(o);
  const stamp = done ? { done_at: sqlNow(), done_by: actor, done_by_email: o.email ? o.email.toLowerCase() : null } : { done_at: null, done_by: null, done_by_email: null };
  if (kind === 'backlink') {
    const row = await prisma.backlink_tasks.update({ where: { id }, data: { status: done ? 'done' : 'manual', ...stamp, ...details } });
    await activity.log(done ? 'manual.done' : 'manual.reopened', { entityType: 'backlink_task', entityId: id, details: `${row.method}: ${row.target_site}${done && row.listing_url ? ` (listing: ${row.listing_url})` : ''}`, actor });
    return row;
  }
  const row = await prisma.technical_fix_tasks.update({ where: { id }, data: { status: done ? 'done_by_person' : 'manual', applied_at: sqlNow(), ...stamp, ...details } });
  await activity.log(done ? 'manual.done' : 'manual.reopened', { entityType: 'technical_fix', entityId: id, details: `${row.url}: ${row.issue}`, actor });
  return row;
}

// Saves the listing address and notes without changing whether the task is done.
export async function saveTaskDetails(kind: string, id: number, d: TaskDetails, actor: string) {
  const details = cleanDetails(d);
  if (!Object.keys(details).length) throw Object.assign(new Error('Nothing to save.'), { status: 400 });
  const row: any = kind === 'backlink' ? await prisma.backlink_tasks.update({ where: { id }, data: details }) : await prisma.technical_fix_tasks.update({ where: { id }, data: details });
  await activity.log('manual.details', { entityType: kind === 'backlink' ? 'backlink_task' : 'technical_fix', entityId: id, details: `${kind === 'backlink' ? `${row.method}: ${row.target_site}` : `${row.url}: ${row.issue}`}: listing details saved${row.listing_url ? ` (${row.listing_url})` : ''}`, actor });
  return row;
}

function guidePrompt(kind: string) {
  return `You write a step-by-step task guide for a junior marketing assistant at USAIndiaCFO (${SITE()}), a firm offering cross-border CFO, accounting, tax, company formation and compliance services for US and India businesses. The reader has NEVER done this before and must be able to finish alone.

Rules:
- Use web search to find the CURRENT official page for this task (sign-up / claim / add listing / help page) and give its exact URL. Never guess a URL.
- Use web search on ${SITE()} (home, about, services, contact pages) for company facts. Use ONLY facts you found there. For anything you could not find (phone, founding year, team size, address, rates), write "[Fill in: what is needed]". Never invent facts, prices or reviews.
- Sign-in: tell them to use the company's shared marketing email (not a personal account) and to ask their manager for the password if they do not have it. Never write a password.
- Say what to prepare first (logo file, email access, phone for verification, etc.).
- Number every click in order, naming the exact button or menu text where possible.
- Give ready-to-paste text for every form field (company name, tagline, short and long description, services, industries, website, etc.), written in a professional, factual voice. Respect the platform's usual length limits.
- Explain how to check it worked, and what to do if it asks for verification or is rejected.
- No em dashes.
${kind === 'fix' ? '- This is a website task a developer must do on the company custom-built website. Explain it for a non-technical person who will pass it to the developer, plus what the developer should change.' : ''}

Return ONLY ===JSON===
{"summary":"what this is and why it helps, 2 sentences","link":"https://main page to start","timeMinutes":15,
 "prepare":["..."],
 "steps":[{"title":"short step","detail":"exactly what to click and type","link":"https://... or empty"}],
 "copy":[{"field":"Field name on the form","value":"text to paste"}],
 "check":"how to confirm it is live",
 "ifStuck":"what to do if verification fails or it is rejected"}
===END===`;
}

export async function guideFor(kind: string, id: number, { regenerate = false, write = callClaude } = {}) {
  const row: any = kind === 'backlink' ? await prisma.backlink_tasks.findUnique({ where: { id } }) : await prisma.technical_fix_tasks.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (row.guide && !regenerate) return parse(row.guide);
  const task =
    kind === 'backlink'
      ? `Task: ${row.method}. Target: ${row.target_site}. Our page to link to: ${row.our_page || SITE()}.`
      : `Task: ${row.issue} on ${row.url}. Suggested fix: ${row.fix}. Why it was not done automatically: ${row.result || 'needs a person'}.`;
  const { lessonsBlock } = await import('../lessons');
  const { text } = await write(guidePrompt(kind) + (await lessonsBlock()), [{ role: 'user', content: task }], undefined, { maxUses: 8, effort: 'medium', feature: 'manual-guide' });
  const guide = parseJson(text);
  if (!guide || !Array.isArray(guide.steps)) throw new Error('Could not write the guide. Try again.');
  const json = JSON.stringify(guide).replace(/—/g, ',');
  if (kind === 'backlink') await prisma.backlink_tasks.update({ where: { id }, data: { guide: json } });
  else await prisma.technical_fix_tasks.update({ where: { id }, data: { guide: json } });
  return JSON.parse(json);
}

export async function assignedTo(kind: string, id: number): Promise<string | null> {
  const row: any = kind === 'backlink'
    ? await prisma.backlink_tasks.findUnique({ where: { id }, select: { assigned_to: true } })
    : await prisma.technical_fix_tasks.findUnique({ where: { id }, select: { assigned_to: true } });
  return row?.assigned_to || null;
}

export async function assignTask(kind: string, id: number, email: string | null, actor: string) {
  const data = { assigned_to: email ? email.toLowerCase() : null };
  if (kind === 'backlink') await prisma.backlink_tasks.update({ where: { id }, data });
  else await prisma.technical_fix_tasks.update({ where: { id }, data });
  await activity.log('manual.assigned', { entityType: kind === 'backlink' ? 'backlink_task' : 'technical_fix', entityId: id, details: email ? `Assigned to ${email}` : 'Unassigned', actor });
}

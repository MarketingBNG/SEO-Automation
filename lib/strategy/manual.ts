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

const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');

export type ManualTask = {
  kind: 'backlink' | 'fix';
  id: number;
  title: string;
  detail: string;
  date: string | null;
  done: boolean;
  guide: any | null;
};

const parse = (s?: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

export async function listManualTasks(strategyId: number): Promise<ManualTask[]> {
  const links = await prisma.backlink_tasks.findMany({ where: { strategy_id: strategyId, OR: [{ status: 'manual' }, { status: 'done', note: { contains: 'person' } }] }, orderBy: { send_date: 'asc' } });
  const fixes = await prisma.technical_fix_tasks.findMany({ where: { strategy_id: { in: [strategyId, 0] }, OR: [{ status: 'manual' }, { status: 'done_by_person' }] }, orderBy: { id: 'asc' } });
  return [
    ...links.map((l) => ({
      kind: 'backlink' as const,
      id: l.id,
      title: `${l.method}: ${l.target_site}`,
      detail: `Link to ${l.our_page || SITE()}. ${l.note || ''}`.trim(),
      date: l.send_date || null,
      done: l.status === 'done',
      guide: parse(l.guide),
    })),
    ...fixes.map((f) => ({
      kind: 'fix' as const,
      id: f.id,
      title: `${f.issue} on ${f.url}`,
      detail: `${f.fix}. ${f.result || ''}`.trim(),
      date: f.applied_at || null,
      done: f.status === 'done_by_person',
      guide: parse(f.guide),
    })),
  ];
}

export async function setManualDone(kind: string, id: number, done: boolean, actor: string) {
  if (kind === 'backlink') {
    const row = await prisma.backlink_tasks.update({ where: { id }, data: { status: done ? 'done' : 'manual', note: done ? `Done by a person (${actor})` : 'Directory sign-up needs a person (forms and captchas).' } });
    await activity.log(done ? 'manual.done' : 'manual.reopened', { entityType: 'backlink_task', entityId: id, details: `${row.method}: ${row.target_site}`, actor });
    return row;
  }
  const row = await prisma.technical_fix_tasks.update({ where: { id }, data: { status: done ? 'done_by_person' : 'manual', applied_at: sqlNow() } });
  await activity.log(done ? 'manual.done' : 'manual.reopened', { entityType: 'technical_fix', entityId: id, details: `${row.url}: ${row.issue}`, actor });
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
${kind === 'fix' ? '- This is a website task a developer or WordPress admin must do. Explain it for a non-technical person who will pass it to a developer, plus the exact steps in WordPress or hosting if it can be done there.' : ''}

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
  const { text } = await write(guidePrompt(kind), [{ role: 'user', content: task }], undefined, { maxUses: 8, effort: 'medium', feature: 'manual-guide' });
  const guide = parseJson(text);
  if (!guide || !Array.isArray(guide.steps)) throw new Error('Could not write the guide. Try again.');
  const json = JSON.stringify(guide).replace(/—/g, ',');
  if (kind === 'backlink') await prisma.backlink_tasks.update({ where: { id }, data: { guide: json } });
  else await prisma.technical_fix_tasks.update({ where: { id }, data: { guide: json } });
  return JSON.parse(json);
}

// Brand Palette: from a short brief, the Creative Director (following the skills learned from YouTube,
// lib/creativeSkills.ts) explores six colour directions, critiques them against a rubric, and refines
// the best three. The maths is then done in code, never by the AI: every colour's tint/shade scale,
// the WCAG contrast of every text and UI pairing, and the nearest accessible fix for any that fail.
//
// Built with callClaude: in Testing mode a palette waits in the Claude Code queue (no API credits).
import prisma from './prisma';
import * as activity from './activity';
import { sqlNow } from './time';
import { callClaude } from './anthropic';
import { skillsForPrompt, MASTER } from './creativeSkills';
import { accessible, contrast, grade, normHex, scale, textOn } from './color';
import { startTimer, endTimer } from './jobTimer';

const MODEL = () => process.env.SKILL_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const SKILLS = [MASTER, 'color-theory-and-color-pairing-design', 'typography-and-font-pairing', 'logo-design', 'graphic-design-basics-to-advanced', 'creativity-and-creative-thinking'];
export const ROLES = ['primary', 'secondary', 'accent', 'neutral-dark', 'neutral-light', 'background', 'success', 'warning', 'danger'] as const;

export type Brief = {
  name: string;
  business?: string;
  audience?: string;
  personality?: string;
  evoke?: string;
  avoidFeelings?: string;
  competitors?: string;
  keep?: string;
  avoid?: string;
  uses?: string;
  notes?: string;
};

const SYSTEM = (skills: string) => `You are the Creative Director and a senior brand colour designer. You build colour systems that a strong human designer would need five or six attempts to match.
${skills ? `\nFollow the skills below (learned from professional designers). Where they give rules or numbers, use them.\n\n${skills}\n` : '\nNo learned skills are available yet: use established professional brand-design practice.\n'}
Method:
1. Strategy first: what must the colours signal for this brand, its audience and its category? Note the category's colour conventions and how to stand out while staying credible.
2. Explore six genuinely different directions (different hue families, temperatures and contrast strategies). Score each 1 to 10 on: brand fit, distinctiveness against the competitors, trust and credibility, accessibility, versatility (social, web, print, video, dark backgrounds), emotional resonance, and cultural fit for India and the US.
3. Drop the three weakest (say why in one line each). Refine the best three until every score is 8 or more.
4. For each direction give a full system: primary, secondary, accent, neutral-dark (body text), neutral-light, background, and success / warning / danger, each with an exact 6-digit hex and the reason for it; the 60-30-10 proportion; a heading and a body font from Google Fonts with the reason; and short do / don't rules.

Rules: keep every colour the brief asks to keep; never use a colour it asks to avoid; body text must be readable on the background (aim for 7:1, never under 4.5:1). Write plainly, no em dashes.

Return only JSON between ===JSON=== and ===END===:
{"strategy":"...","directions":[{"name":"...","idea":"one sentence","story":"why it fits","colors":[{"role":"primary","name":"...","hex":"#RRGGBB","why":"..."}],"ratio":"60% ..., 30% ..., 10% ...","typography":{"heading":"...","body":"...","why":"..."},"do":["..."],"dont":["..."],"scores":{"brand_fit":0,"distinctive":0,"trust":0,"accessibility":0,"versatility":0,"emotion":0,"culture":0},"critique":"the weakness that remains and how to manage it"}],"dropped":["name: why"]}`;

const briefText = (b: Brief) =>
  [
    `Brand: ${b.name}`,
    b.business && `What it does: ${b.business}`,
    b.audience && `Audience: ${b.audience}`,
    b.personality && `Personality: ${b.personality}`,
    b.evoke && `Feelings to evoke: ${b.evoke}`,
    b.avoidFeelings && `Feelings to avoid: ${b.avoidFeelings}`,
    b.competitors && `Competitors and their colours: ${b.competitors}`,
    b.keep && `Colours to keep: ${b.keep}`,
    b.avoid && `Colours to avoid: ${b.avoid}`,
    b.uses && `Where it will be used: ${b.uses}`,
    b.notes && `Notes: ${b.notes}`,
  ]
    .filter(Boolean)
    .join('\n');

// The checks a palette must pass, worked out in code from the hex values.
export function analyse(direction: any) {
  const byRole: Record<string, string> = {};
  const colors = (direction.colors || [])
    .map((c: any) => ({ ...c, hex: normHex(String(c.hex || '')) }))
    .filter((c: any) => c.hex);
  for (const c of colors) if (!byRole[c.role]) byRole[c.role] = c.hex;
  const bg = byRole.background || byRole['neutral-light'] || '#FFFFFF';
  const text = byRole['neutral-dark'] || textOn(bg);
  const pairs: { label: string; fg: string; bg: string; min: number }[] = [
    { label: 'Body text on background', fg: text, bg, min: 4.5 },
    ...(byRole.primary ? [{ label: 'Primary as text on background', fg: byRole.primary, bg, min: 4.5 }, { label: 'Text on primary', fg: textOn(byRole.primary), bg: byRole.primary, min: 4.5 }] : []),
    ...(byRole.secondary ? [{ label: 'Text on secondary', fg: textOn(byRole.secondary), bg: byRole.secondary, min: 4.5 }] : []),
    ...(byRole.accent ? [{ label: 'Accent on background (buttons, icons)', fg: byRole.accent, bg, min: 3 }, { label: 'Text on accent (button label)', fg: textOn(byRole.accent), bg: byRole.accent, min: 4.5 }] : []),
    ...(byRole.accent && byRole.primary ? [{ label: 'Accent on primary', fg: byRole.accent, bg: byRole.primary, min: 3 }] : []),
    ...(['success', 'warning', 'danger'] as const).filter((r) => byRole[r]).map((r) => ({ label: `${r[0].toUpperCase()}${r.slice(1)} on background`, fg: byRole[r], bg, min: 3 })),
  ];
  const checks = pairs.map((p) => {
    const ratio = contrast(p.fg, p.bg);
    const pass = ratio >= p.min;
    return { ...p, ratio, grade: grade(ratio), pass, fix: pass ? null : accessible(p.fg, p.bg, p.min) };
  });
  return {
    ...direction,
    colors: colors.map((c: any) => ({ ...c, scale: scale(c.hex), text: textOn(c.hex) })),
    checks,
    passing: checks.filter((c) => c.pass).length,
    total: checks.length,
    worst: checks.length ? Math.min(...checks.map((c) => c.ratio)) : null,
  };
}

function parse(text: string) {
  const m = /===JSON===([\s\S]*?)===END===/.exec(text);
  const raw = (m ? m[1] : text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (!Array.isArray(json.directions) || !json.directions.length) throw new Error('The palette came back without directions.');
  return json;
}

async function run(id: number, brief: Brief, extra = '') {
  const key = `palette-${id}`;
  startTimer(key, 'palette', `Brand palette: ${brief.name}`);
  try {
    const skills = await skillsForPrompt(SKILLS, 30000);
    const { text } = await callClaude(SYSTEM(skills), [{ role: 'user', content: `${briefText(brief)}${extra}` }], undefined, { maxUses: 0, effort: 'high', model: MODEL(), feature: 'brand' });
    const json = parse(text);
    const result = { strategy: json.strategy || '', dropped: json.dropped || [], directions: json.directions.slice(0, 3).map(analyse), skillsUsed: skills ? SKILLS : [] };
    await prisma.brand_palettes.update({ where: { id }, data: { status: 'ready', result: JSON.stringify(result), error: null, updated_at: sqlNow() } });
    await activity.log('brand.palette_ready', { entityType: 'brand_palette', entityId: id, details: `"${brief.name}": ${result.directions.length} palette direction(s) ready` });
    await endTimer(key, true);
  } catch (e: any) {
    await prisma.brand_palettes.update({ where: { id }, data: { status: 'failed', error: String(e.message || e).slice(0, 500), updated_at: sqlNow() } }).catch(() => {});
    await endTimer(key, false);
  }
}

export async function startPalette(brief: Brief, actor: string) {
  if (!String(brief.name || '').trim()) throw Object.assign(new Error('Give the brand name.'), { status: 400 });
  const row = await prisma.brand_palettes.create({ data: { name: brief.name.slice(0, 120), brief: JSON.stringify(brief), created_by: actor } });
  void run(row.id, brief);
  return row;
}

// A new palette that keeps one direction's idea and applies the reviewer's feedback to it.
export async function refinePalette(id: number, index: number, feedback: string, actor: string) {
  const p = await prisma.brand_palettes.findUnique({ where: { id } });
  if (!p?.result) throw Object.assign(new Error('Palette not found or not ready.'), { status: 404 });
  const d = JSON.parse(p.result).directions?.[index];
  if (!d) throw Object.assign(new Error('Direction not found.'), { status: 404 });
  const brief: Brief = JSON.parse(p.brief);
  const keep = { name: d.name, idea: d.idea, colors: (d.colors || []).map((c: any) => ({ role: c.role, name: c.name, hex: c.hex })), typography: d.typography };
  const extra = `\n\nRefine this chosen direction into three improved variations (same idea, better execution):\n${JSON.stringify(keep)}\n\nReviewer feedback to apply: ${feedback || 'make it stronger and more distinctive while keeping it credible'}`;
  const row = await prisma.brand_palettes.create({ data: { name: `${p.name} (refined)`.slice(0, 120), brief: p.brief, parent_id: id, created_by: actor } });
  void run(row.id, brief, extra);
  return row;
}

export { exportTokens } from './brandPaletteExport';

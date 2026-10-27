// Photo covers for blogs, in the house design: a real photo that fits the topic, darkened on the
// left, the title in white with its second part in gold, a short gold line, an optional subtitle,
// and the logo top left. 1200x630 (blog header and social shares).
// The photo comes from Pexels (free stock photos, real photography) matched to the blog's topic; when
// no good photo is found, an AI photo is made (OpenAI, paid per image). Each photo is used once.
// Made once per blog and saved as its cover; without keys the branded cover (lib/cover.ts) stays.
// When the Social Media dashboard shares its design skills (lib/socialSkills.ts), a small AI step art-directs each
// banner first: better photo searches, a better AI photo prompt, and which words of the title go gold.
import prisma from './prisma';
import * as settings from './settings';
import { saveFile } from './storage';
import { composeCover } from './cover';


// Topic words -> what the photo should show (searched on Pexels, newest topic match first).
const SCENES: [RegExp, string[]][] = [
  [/itin|ein|irs|tax|itr|1040|tds|tcs|dtaa|return/i, ['tax documents desk calculator', 'tax forms paperwork office']],
  [/llc|c-?corp|incorporat|company|registration|formation|subsidiar|delaware|wyoming|entity/i, ['business office desk documents city', 'startup founder office laptop']],
  [/bank|payment|paid|payoneer|stripe|wire|remit|transfer/i, ['online payment laptop business', 'banking finance laptop desk']],
  [/fema|rbi|odi|fdi|lrs|ecb|investment|foreign/i, ['international business meeting finance', 'investment documents office']],
  [/nri|oci|visa|h-1b|immigra/i, ['passport travel documents', 'international airport business traveller']],
  [/gst|invoice|account|bookkeep|cfo|audit|compliance/i, ['accounting office desk laptop', 'financial report analysis desk']],
];
const DEFAULT_SCENES = ['business office desk laptop city view', 'finance professional office'];

export function photoQueries(topic: string): string[] {
  const hit = SCENES.find(([re]) => re.test(topic));
  return [...(hit ? hit[1] : []), ...DEFAULT_SCENES];
}

async function usedPhotos(): Promise<string[]> {
  try {
    return JSON.parse((await settings.get('cover_photos_used')) || '[]');
  } catch {
    return [];
  }
}

async function pexelsPhoto(topic: string, first: string[] = []): Promise<Buffer | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const used = await usedPhotos();
  for (const q of [...first, ...photoQueries(topic)]) {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=30`, { headers: { Authorization: key }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res?.ok) continue;
    const photos: any[] = ((await res.json().catch(() => ({}))) as any).photos || [];
    const pick = photos.find((p) => !used.includes(`pexels-${p.id}`) && p.width >= 1600);
    if (!pick) continue;
    const img = await fetch(pick.src.large2x || pick.src.original, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!img?.ok) continue;
    await settings.set('cover_photos_used', JSON.stringify([...used, `pexels-${pick.id}`].slice(-2000)));
    return Buffer.from(await img.arrayBuffer());
  }
  return null;
}

async function aiPhoto(topic: string, direction?: string): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  // The art director's scene when there is one; the house rules for the photo always apply.
  const scene = direction ? direction.slice(0, 900) : `A premium modern office for a cross-border finance and tax firm, scene about: ${topic}. Real objects only (desk, documents, laptop, small Indian and US desk flags, city skyline through the window).`;
  const prompt = `Professional editorial photograph, shot on a full-frame camera, natural window light, shallow depth of field. ${scene} The left third of the frame is calm and slightly darker so a headline can sit on it. No people's faces, no text, no letters, no logos, no watermark. Realistic, not illustrated, not 3D render.`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.COVER_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1536x1024', n: 1 }),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const b64 = ((await res.json().catch(() => ({}))) as any)?.data?.[0]?.b64_json;
  return b64 ? Buffer.from(b64, 'base64') : null;
}

type Direction = { queries: string[]; photo: string; gold: string };

// Art direction for one banner, following the design skills learned in the Social Media dashboard. A small call on a
// light model; skipped (the usual banner is made) when the skills are not shared, in Testing mode, or on any error.
async function artDirection(title: string, topic: string): Promise<Direction | null> {
  const skills = await import('./socialSkills').then((m) => m.designSkills()).catch(() => '');
  if (!skills) return null;
  const { aiMode } = await import('./aiQueue');
  if ((await aiMode()) === 'testing') return null;
  try {
    const { callClaude } = await import('./anthropic');
    const system = `You are the art director for the blog banners of USAIndiaCFO, a CFO, tax and compliance firm for Indian founders, NRIs and US-India businesses. The banner design is fixed: a landscape photo, darkened on the left third where the title sits in bold white, with its last words in gold. You choose only:
1. queries: three short stock-photo searches (Pexels) for a real photograph that tells this blog's story with concrete objects and a setting (not abstract ideas, no people's faces);
2. photo: one or two sentences describing that photo for an AI image if no stock photo fits: subject, setting, light and mood, with the left third calm and darker;
3. gold: the last 2 to 5 words of the title, copied exactly, that carry the hook (they are set in gold).
Follow the design skills below (composition, hierarchy, contrast, colour and light). Premium and calm, never flashy.

${skills}

Return only JSON: {"queries": ["...", "...", "..."], "photo": "...", "gold": "..."}`;
    const { text } = await callClaude(system, [{ role: 'user', content: `Blog title: ${title}\nTopic: ${topic}` }], undefined, { maxUses: 0, effort: 'low', model: process.env.BANNER_MODEL || process.env.FACT_CHECK_MODEL || 'claude-haiku-5-5', feature: 'banner' });
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const queries = (Array.isArray(j.queries) ? j.queries : []).map((x: unknown) => String(x).slice(0, 80)).filter(Boolean).slice(0, 3);
    return { queries, photo: String(j.photo || '').slice(0, 900), gold: String(j.gold || '').slice(0, 80) };
  } catch {
    return null;
  }
}

// Makes and saves the photo cover for a draft that has none. Returns the stored key, or null when
// no photo source is set up or nothing worked (the branded cover is then used, as before).
export async function ensurePhotoCover(draftId: number): Promise<string | null> {
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, include: { keyword: { select: { keyword: true } } } });
  if (!d || d.featured_image_path || d.kind === 'article') return d?.featured_image_path || null;
  const topic = `${d.title || ''} ${d.keyword?.keyword || ''}`.trim();
  const title = d.title || d.keyword?.keyword || 'USAIndiaCFO';
  const dir = await artDirection(title, topic);
  const photo = (await pexelsPhoto(topic, dir?.queries).catch(() => null)) || (await aiPhoto(topic, dir?.photo).catch(() => null));
  // Made in the Social Media dashboard (lib/socialSkills.ts), which also finds a photo when there is none here; made here
  // as before when that link is not set up or fails.
  const { socialBanner } = await import('./socialSkills');
  const made = await socialBanner({ title, topic, gold: dir?.gold, queries: dir?.queries, direction: dir?.photo, photo });
  const jpg = made || (photo ? await composeCover(photo, title, { gold: dir?.gold }) : null);
  if (!jpg) return null;
  const key = await saveFile(`draft-${draftId}-cover-${Date.now()}.jpg`, jpg);
  // Only if nobody uploaded a cover meanwhile.
  await prisma.drafts.updateMany({ where: { id: draftId, featured_image_path: null }, data: { featured_image_path: key } });
  return key;
}

// Every blog not yet on the website gets its banner by itself: a few per scheduler run, so nobody has to press anything.
// A blog that could not get one is tried again after six hours.
export async function fillMissingCovers(max = 2): Promise<number> {
  const tried: Record<string, number> = JSON.parse((await settings.get('cover_fill_tried').catch(() => null)) || '{}');
  const now = Date.now();
  const rows = await prisma.drafts.findMany({
    where: { featured_image_path: null, wp_post_url: null, kind: { not: 'article' }, status: { notIn: ['in_progress', 'rejected', 'published'] } },
    select: { id: true },
    orderBy: { id: 'desc' },
    take: 20,
  });
  let made = 0;
  for (const r of rows.filter((x) => now - (tried[x.id] || 0) > 6 * 3600000).slice(0, max)) {
    tried[r.id] = now;
    if (await ensurePhotoCover(r.id).catch(() => null)) made++;
  }
  for (const k of Object.keys(tried)) if (now - tried[k] > 7 * 86400000) delete tried[k];
  await settings.set('cover_fill_tried', JSON.stringify(tried)).catch(() => {});
  return made;
}

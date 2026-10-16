// Photo covers for blogs, in the house design: a real photo that fits the topic, darkened on the
// left, the title in white with its second part in gold, a short gold line, an optional subtitle,
// and the logo top left. 1200x630 (blog header and social shares).
// The photo comes from Pexels (free stock photos, real photography) matched to the blog's topic; when
// no good photo is found, an AI photo is made (OpenAI, paid per image). Each photo is used once.
// Made once per blog and saved as its cover; without keys the branded cover (lib/cover.ts) stays.
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

async function pexelsPhoto(topic: string): Promise<Buffer | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const used = await usedPhotos();
  for (const q of photoQueries(topic)) {
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

async function aiPhoto(topic: string): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = `Professional editorial photograph, shot on a full-frame camera, natural window light, shallow depth of field. A premium modern office for a cross-border finance and tax firm, scene about: ${topic}. Real objects only (desk, documents, laptop, small Indian and US desk flags, city skyline through the window). The left third of the frame is calm and slightly darker so a headline can sit on it. No people's faces, no text, no letters, no logos, no watermark. Realistic, not illustrated, not 3D render.`;
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

// Makes and saves the photo cover for a draft that has none. Returns the stored key, or null when
// no photo source is set up or nothing worked (the branded cover is then used, as before).
export async function ensurePhotoCover(draftId: number): Promise<string | null> {
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, include: { keyword: { select: { keyword: true } } } });
  if (!d || d.featured_image_path || d.kind === 'article') return d?.featured_image_path || null;
  const topic = `${d.title || ''} ${d.keyword?.keyword || ''}`.trim();
  const photo = (await pexelsPhoto(topic).catch(() => null)) || (await aiPhoto(topic).catch(() => null));
  if (!photo) return null;
  const jpg = await composeCover(photo, d.title || d.keyword?.keyword || 'USAIndiaCFO');
  const key = await saveFile(`draft-${draftId}-cover-${Date.now()}.jpg`, jpg);
  // Only if nobody uploaded a cover meanwhile.
  await prisma.drafts.updateMany({ where: { id: draftId, featured_image_path: null }, data: { featured_image_path: key } });
  return key;
}

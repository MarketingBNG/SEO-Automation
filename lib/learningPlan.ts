// Pure helpers for Learn from YouTube (no database, no network), so they can be tested on their own:
// reading YouTube links and durations, the watch order, splitting long videos into parts, and reading
// a row of the learning library spreadsheet.

// The categories of the learning library, in the order they matter most for a CFO / tax advisory
// brand's creative work (design and brand first, 3D last). A new category goes in the middle.
export const CATEGORIES = [
  'Creativity & Creative Thinking',
  'Graphic Design: Basics to Advanced',
  'Color Theory & Color Pairing (Design)',
  'Typography & Font Pairing',
  'Logo Design',
  'Editing Mindset, Storytelling & Pacing',
  'Motion Graphics',
  'Text Animation, Captions & Text Behind Subject',
  'Video Editing: Fundamentals to Pro',
  'Sound Design & SFX',
  'Voiceover (Recording & Delivery)',
  'AI Voiceover',
  'Color Grading & Color Contrast (Video)',
  'Video Lighting (incl. Motion Graphics Lighting)',
  'VFX',
  'Animation (Principles + Blender)',
  '3D Lighting & Rendering (Blender)',
  'Texturing, Materials & UV (Blender)',
  '3D Modeling (Blender)',
];

export const slugOf = (category: string) =>
  String(category || 'general')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'general';

// "https://www.youtube.com/watch?v=ID", "youtu.be/ID", "/shorts/ID", "/embed/ID", "/live/ID" or a bare id.
export function youtubeId(input: string): string | null {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{11}/.exec(u.pathname.slice(1))?.[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// "0:13:31", "3:27:39", "20:06:13", "13:31", "1 day, 7:41:09", seconds, or a spreadsheet time (a
// fraction of a day) -> seconds. Unknown -> null.
export function durationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 5 ? Math.round(value * 86400) : Math.round(value);
  }
  const s = String(value).trim();
  const day = /^(\d+)\s*days?,\s*(.*)$/i.exec(s);
  if (day) {
    const rest = durationSeconds(day[2]);
    return rest === null ? null : Number(day[1]) * 86400 + rest;
  }
  const parts = s.split(':').map((p) => p.trim());
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 3) return Math.round(n[0] * 3600 + n[1] * 60 + n[2]);
  if (n.length === 2) return Math.round(n[0] * 60 + n[1]);
  if (n.length === 1) return Math.round(n[0]);
  return null;
}

export function formatDuration(sec: number | null | undefined) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const LEVEL_RANK = (level: string | null | undefined) => {
  const l = String(level || '').toLowerCase();
  if (/theory|mindset/.test(l)) return 0;
  if (/beginner/.test(l)) return 1;
  if (/intermediate/.test(l)) return 2;
  if (/advanced/.test(l)) return 3;
  return 2;
};

const CATEGORY_RANK = (category: string) => {
  const i = CATEGORIES.indexOf(category);
  return i === -1 ? 9 : i;
};

// Watch order (lower first): short videos before long courses (quick lessons for the skills first,
// the 8 to 20 hour software courses last), then theory before beginner before advanced, then the
// categories that matter most for the brand, then the library's own order.
export function priorityOf(v: { duration_sec?: number | null; level?: string | null; category: string; sort_order?: number | null }) {
  const d = v.duration_sec ?? 1800;
  const bucket = d <= 30 * 60 ? 0 : d <= 90 * 60 ? 1 : d <= 3 * 3600 ? 2 : 3;
  return bucket * 10000 + LEVEL_RANK(v.level) * 1000 + CATEGORY_RANK(v.category) * 20 + Math.min(19, v.sort_order ?? 10);
}

// Gemini watches up to about 3 hours of video in one request (at the default resolution). A longer
// video is watched in parts of 2.5 hours. Unknown length: one request for the whole video.
export const PART_SECONDS = 9000;
export const ONE_REQUEST_MAX = 3 * 3600;
export function planParts(durationSec: number | null | undefined): { start: number; end: number }[] | null {
  if (!durationSec || durationSec <= ONE_REQUEST_MAX) return null;
  const parts: { start: number; end: number }[] = [];
  for (let start = 0; start < durationSec; start += PART_SECONDS) parts.push({ start, end: Math.min(durationSec, start + PART_SECONDS) });
  return parts;
}

// The day Gemini's free daily limit counts in (it resets at midnight Pacific time).
export function quotaDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export type LibraryRow = {
  video_id: string;
  url: string;
  title: string | null;
  channel: string | null;
  category: string;
  sort_order: number | null;
  level: string | null;
  duration_sec: number | null;
  note: string | null;
};

// One row of the learning library spreadsheet (column names as in "YouTube_Learning_Library.xlsx";
// other sheets with a YouTube link column work too). Rows without a YouTube link are skipped.
export function libraryRow(row: Record<string, unknown>): LibraryRow | null {
  const get = (...names: RegExp[]) => {
    for (const key of Object.keys(row)) if (names.some((n) => n.test(key.trim()))) return row[key];
    return undefined;
  };
  const link = String(get(/^youtube link$/i, /^link$/i, /^url$/i, /youtube/i) ?? '').trim();
  const id = youtubeId(link) || youtubeId(String(get(/^video id$/i) ?? ''));
  if (!id) return null;
  const text = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s ? s : null;
  };
  const order = Number(get(/^order$/i));
  return {
    video_id: id,
    url: watchUrl(id),
    title: text(get(/^video title/i, /^title$/i)),
    channel: text(get(/^channel$/i)),
    category: text(get(/^category$/i)) || 'General',
    sort_order: Number.isFinite(order) && order > 0 ? order : null,
    level: text(get(/^level$/i)),
    duration_sec: durationSeconds(get(/^duration$/i)),
    note: text(get(/^note$/i)),
  };
}

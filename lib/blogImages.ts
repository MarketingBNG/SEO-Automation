// Images inside a blog body. The writer only marks where a visual would help ([VISUAL SUGGESTION:
// ...]); a person uploads an image for each spot (or removes the note), or adds one after any
// section. Images live in the dashboard's storage until publish, when each one is uploaded to the
// WordPress Media Library and the post points at the WordPress copy.
const NOTE_RE = /<p[^>]*>\s*\[VISUAL SUGGESTION:?[^\]]{0,500}\]\s*<\/p>|\[VISUAL SUGGESTION:?\s*([^\]]{0,500})\]/gi;
const H2_RE = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
const IMG_RE = /<img\b[^>]*\bsrc="\/api\/uploads\/([^"]+)"[^>]*>/gi;

export const UPLOAD_PREFIX = '/api/uploads/';

const strip = (s: string) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const escAttr = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unescAttr = (s: string) => String(s || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
// A storage key as it appears in a src attribute; a malformed escape is kept as typed.
export function decodeKey(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

export type ImageSlot = { index: number; text: string; section: string | null };

// The H2 section headings, in order, as plain text.
export function sectionHeadings(html: string): string[] {
  return [...String(html || '').matchAll(H2_RE)].map((m) => strip(m[1]));
}

// The FAQ section's answers are read by Google as plain text, so images do not go there.
export const isFaqHeading = (text: string) => /^\s*(frequently asked questions|faqs?)\b/i.test(String(text || ''));

// Every [VISUAL SUGGESTION] note: what the writer suggested and which section it sits in.
export function imageSlots(html: string): ImageSlot[] {
  const src = String(html || '');
  const out: ImageSlot[] = [];
  let index = 0;
  for (const m of src.matchAll(NOTE_RE)) {
    const text = (m[1] ?? (m[0].match(/\[VISUAL SUGGESTION:?\s*([^\]]*)\]/i) || [])[1] ?? '').trim();
    const heads = [...src.slice(0, m.index).matchAll(H2_RE)];
    out.push({ index: index++, text, section: heads.length ? strip(heads[heads.length - 1][1]) : null });
  }
  return out;
}

// The markup for an image stored on the dashboard (plain tags, so previews and Word show it).
export function imageTag(key: string, alt: string, caption?: string): string {
  return `<p><img src="${UPLOAD_PREFIX}${encodeURI(key)}" alt="${escAttr(alt)}" /></p>${caption ? `<p><em>${escAttr(caption)}</em></p>` : ''}`;
}

// Replaces the n-th suggestion note with `tag` (an empty tag removes the note).
export function placeAtSlot(html: string, slot: number, tag: string): string {
  let i = 0;
  return String(html || '').replace(NOTE_RE, (m) => (i++ === slot ? tag : m));
}
export const removeNote = (html: string, slot: number) => placeAtSlot(html, slot, '');

// Inserts `tag` after the first paragraph of the n-th H2 section (right after the heading when the
// section has no paragraph); past the last heading it goes at the end.
export function placeAfterSection(html: string, heading: number, tag: string): string {
  const src = String(html || '');
  const heads = [...src.matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/gi)];
  const h = heads[heading];
  if (!h || h.index === undefined) return `${src}\n${tag}`;
  const from = h.index + h[0].length;
  const rest = src.slice(from);
  const nextHead = rest.search(/<h[23][^>]*>/i);
  const section = nextHead < 0 ? rest : rest.slice(0, nextHead);
  const pEnd = section.indexOf('</p>');
  const at = pEnd < 0 ? from : from + pEnd + 4;
  return `${src.slice(0, at)}\n${tag}\n${src.slice(at)}`;
}

// Storage keys of the body images that live on the dashboard.
export function inlineImageKeys(html: string): string[] {
  return [...new Set([...String(html || '').matchAll(IMG_RE)].map((m) => decodeKey(m[1])))];
}

export type Media = { id: number; url: string };

// At publish: each dashboard image is uploaded to WordPress and the tag points at that copy.
// `known` holds images uploaded on an earlier attempt (key -> media), so a retry reuses them
// instead of filling the Media Library with duplicates.
export async function publishInlineImages(html: string, upload: (key: string, alt: string) => Promise<Media>, known: Record<string, Media> = {}) {
  const src = String(html || '');
  const media: Record<string, Media> = { ...known };
  const uploaded: { key: string; id: number; url: string; reused: boolean }[] = [];
  for (const m of src.matchAll(IMG_RE)) {
    const key = decodeKey(m[1]);
    if (media[key]) continue;
    const alt = (m[0].match(/\balt="([^"]*)"/i) || ['', ''])[1];
    media[key] = await upload(key, unescAttr(alt));
  }
  const out = src.replace(IMG_RE, (m, raw) => {
    const key = decodeKey(raw);
    const w = media[key];
    if (!w) return m;
    uploaded.push({ key, id: w.id, url: w.url, reused: Boolean(known[key]) });
    const alt = (m.match(/\balt="([^"]*)"/i) || ['', ''])[1];
    return `<img class="aligncenter size-full wp-image-${w.id}" src="${escAttr(w.url)}" alt="${alt}" />`;
  });
  return { html: out, uploaded };
}

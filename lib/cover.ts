// Blog covers, 1200x630. Text is drawn with font files shipped in the repo (Schibsted Grotesk; Montserrat was turned
// down by the team as looking machine-made, Nov 2026), so it
// renders the same on any server. makeCover needs no photo and no API.
import path from 'path';
import sharp, { type OverlayOptions } from 'sharp';

const W = 1200;
const H = 630;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The house design (also used for photo covers, lib/coverPhoto.ts): the picture darkened on the
// left, the logo top left, the title in bold white with its second part in gold, a short gold line.
const BOLD = path.join(process.cwd(), 'assets/fonts/Schibsted-800.ttf');
const REGULAR = path.join(process.cwd(), 'assets/fonts/Schibsted-400.ttf');
// The full logo with white lettering (made for dark backgrounds).
const LOGO_WHITE = path.join(process.cwd(), 'public/logo-mark.png');
const GOLD = '#E8B04B';

// "Main: Rest" -> white main line(s), gold second part; else the last words go gold. `gold` (from the banner's art
// direction, lib/coverPhoto.ts) chooses the gold words when it is the exact ending of the title.
export function splitTitle(title: string, gold?: string): { white: string; gold: string; sub: string } {
  const t = String(title || '').trim();
  const g = String(gold || '').trim();
  if (g && g.length < t.length && t.toLowerCase().endsWith(g.toLowerCase())) {
    const white = t.slice(0, t.length - g.length).trim().replace(/[:,\u2013-]+$/, '').trim();
    if (white.length >= 8) return { white, gold: t.slice(t.length - g.length), sub: '' };
  }
  const colon = t.match(/^(.{8,}?):\s*(.+)$/);
  if (colon) return { white: colon[1], gold: colon[2], sub: '' };
  const amp = t.match(/^(.+?)\s+(&|and)\s+(.+)$/i);
  if (amp && amp[1].length >= 6) return { white: amp[1], gold: `${amp[2] === '&' ? '&' : 'and'} ${amp[3]}`, sub: '' };
  const words = t.split(/\s+/);
  const cut = Math.max(1, Math.ceil(words.length * 0.6));
  return { white: words.slice(0, cut).join(' '), gold: words.slice(cut).join(' '), sub: '' };
}

async function fontText(markup: string, font: string, family: string, width: number, dpi: number) {
  return sharp({ text: { text: markup, font: family, fontfile: font, width, rgba: true, dpi, wrap: 'word' } }).png().toBuffer();
}

// byline: "By <author>" under the title (makeCover). The title is made smaller until title, gold line
// and byline all fit, so a long title never runs into the byline.
export async function composeCover(photo: Buffer, title: string, opts: { png?: boolean; gold?: string; byline?: string | null } = {}): Promise<Buffer> {
  const base = await sharp(photo).resize(W, H, { fit: 'cover', position: 'attention' }).modulate({ saturation: 1.05 }).toBuffer();
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0B1430" stop-opacity="0.88"/><stop offset="0.45" stop-color="#0B1430" stop-opacity="0.62"/><stop offset="0.75" stop-color="#0B1430" stop-opacity="0.12"/><stop offset="1" stop-color="#0B1430" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`
  );
  // The straight square grid (as the Social Media dashboard draws it), strongest behind the title, fading over the photo.
  const cell = 45;
  const fade = (x: number) => Math.max(0, 0.13 * (1 - x / (W * 0.8))).toFixed(3);
  const vlines = Array.from({ length: Math.ceil(W / cell) + 1 }, (_, i) => `<rect x="${i * cell}" y="0" width="1" height="${H}" fill="#fff" fill-opacity="${fade(i * cell)}"/>`).join('');
  const hlines = Array.from({ length: Math.ceil(H / cell) + 1 }, (_, j) => `<rect x="0" y="${j * cell}" width="${W}" height="1" fill="url(#h)"/>`).join('');
  const grid = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.13"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.05"/><stop offset="0.8" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      ${vlines}${hlines}
      <rect x="${cell * 11}" y="${cell * 11}" width="${cell + 1}" height="${cell + 1}" fill="none" stroke="${GOLD}" stroke-opacity="0.5" stroke-width="1.5"/>
      <rect x="${cell * 12}" y="${cell * 12}" width="${cell + 1}" height="${cell + 1}" fill="${GOLD}" fill-opacity="0.14"/>
    </svg>`
  );
  const { white, gold } = splitTitle(title, opts.gold);
  const by = opts.byline ? await fontText(`<span foreground="#C9D1E8">By ${esc(opts.byline)}</span>`, REGULAR, 'Schibsted Grotesk', 700, 110) : null;
  const byH = by ? (await sharp(by).metadata()).height || 30 : 0;
  let size = title.length > 70 ? 230 : title.length > 45 ? 270 : 320;
  let head: Buffer, headH: number, top: number, ruleTop: number, byTop: number;
  for (;;) {
    head = await fontText(`<span foreground="#FFFFFF">${esc(white)}</span>${gold ? `\n<span foreground="${GOLD}">${esc(gold)}</span>` : ''}`, BOLD, 'Schibsted Grotesk Ultra-Bold', 640, size);
    headH = (await sharp(head).metadata()).height || 300;
    top = Math.max(150, Math.round((H - headH) / 2) + 10);
    ruleTop = Math.min(H - 40, top + headH + 22);
    // The byline sits at the bottom as before, or just under the gold line when the title reaches lower.
    byTop = Math.max(H - 70, top + headH + 22 + 5 + 16);
    if (!by || byTop + byH <= H - 12 || size <= 120) break;
    size = Math.max(120, Math.round(size * 0.9));
  }
  const layers: OverlayOptions[] = [
    { input: shade, left: 0, top: 0 },
    { input: grid, left: 0, top: 0 },
    { input: head, left: 64, top },
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="5"><rect width="88" height="5" rx="2" fill="${GOLD}"/></svg>`), left: 66, top: ruleTop },
  ];
  if (by) layers.push({ input: by, left: 66, top: Math.min(byTop, H - byH) });
  try {
    layers.push({ input: await sharp(LOGO_WHITE).resize({ height: 84, fit: 'inside' }).png().toBuffer(), left: 58, top: 34 });
  } catch {}
  const out = sharp(base).composite(layers);
  return opts.png ? out.png().toBuffer() : out.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}


// Without a photo: a deep navy background with a soft city skyline, in the same design, plus the
// author. No API, so it is always available and looks the same on every server.
// variant (0 = the usual navy; "Try another design" counts up): another background colour, glow
// position and skyline, so a person can pick between designs when no banner service is set up.
const PALETTES: [string, string][] = [
  ['#16244F', '#0A1330'],
  ['#123B4A', '#071E27'],
  ['#3A1C2E', '#1A0B16'],
  ['#25282F', '#101216'],
  ['#1F3A2C', '#0B1A12'],
];
export async function makeCover(title: string, author?: string | null, variant = 0, main?: string): Promise<Buffer> {
  const v = Math.max(0, Math.floor(Number(variant) || 0));
  const [from, to] = PALETTES[v % PALETTES.length];
  const glowX = [0.82, 0.7, 0.9, 0.6][v % 4];
  const shift = (v * 37) % 90;
  const towers = [
    [640, 300, 60], [705, 230, 44], [752, 330, 70], [828, 180, 52], [884, 260, 64], [952, 140, 46], [1002, 280, 58], [1064, 210, 50], [1118, 300, 82],
  ]
    .map(([x, h, w], i) => `<rect x="${x}" y="${H - (v ? Math.max(120, h + ((i * shift) % 120) - 60) : h)}" width="${w}" height="${v ? Math.max(120, h + ((i * shift) % 120) - 60) : h}" fill="#ffffff" fill-opacity="0.06"/>`)
    .join('');
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
        <radialGradient id="glow" cx="${glowX}" cy="0.35" r="0.55"><stop offset="0" stop-color="#E8B04B" stop-opacity="0.22"/><stop offset="1" stop-color="#E8B04B" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      ${towers}
      <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#E8B04B" fill-opacity="0.85"/>
    </svg>`
  );
  const base = await sharp(bg).png().toBuffer();
  // The words a person chose to make bold (the start of the title): the rest of the title goes gold.
  const m = String(main || '').trim();
  const gold = m && m.length < title.length && title.toLowerCase().startsWith(m.toLowerCase()) ? title.slice(m.length).replace(/^[\s:,\u2013-]+/, '') : undefined;
  return composeCover(base, title, { png: true, gold, byline: author || null });
}

// The cover's alt text: what the person wrote, else the title (never empty, so Google always has
// a description of the picture).
export function coverAlt(d: { cover_alt?: string | null; title?: string | null }): string {
  return String(d.cover_alt || d.title || 'Blog cover image').trim().slice(0, 200);
}

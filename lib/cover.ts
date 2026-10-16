// Blog covers, 1200x630. Text is drawn with font files shipped in the repo (Montserrat), so it
// renders the same on any server. makeCover needs no photo and no API.
import path from 'path';
import sharp, { type OverlayOptions } from 'sharp';

const W = 1200;
const H = 630;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The house design (also used for photo covers, lib/coverPhoto.ts): the picture darkened on the
// left, the logo top left, the title in bold white with its second part in gold, a short gold line.
const BOLD = path.join(process.cwd(), 'assets/fonts/Montserrat-Bold.ttf');
const REGULAR = path.join(process.cwd(), 'assets/fonts/Montserrat-Regular.ttf');
// The full logo with white lettering (made for dark backgrounds).
const LOGO_WHITE = path.join(process.cwd(), 'public/logo-mark.png');
const GOLD = '#E8B04B';

// "Main: Rest" -> white main line(s), gold second part; else the last words go gold.
export function splitTitle(title: string): { white: string; gold: string; sub: string } {
  const t = String(title || '').trim();
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

export async function composeCover(photo: Buffer, title: string, opts: { png?: boolean } = {}): Promise<Buffer> {
  const base = await sharp(photo).resize(W, H, { fit: 'cover', position: 'attention' }).modulate({ saturation: 1.05 }).toBuffer();
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0B1430" stop-opacity="0.88"/><stop offset="0.45" stop-color="#0B1430" stop-opacity="0.62"/><stop offset="0.75" stop-color="#0B1430" stop-opacity="0.12"/><stop offset="1" stop-color="#0B1430" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`
  );
  const { white, gold } = splitTitle(title);
  const size = title.length > 70 ? 230 : title.length > 45 ? 270 : 320;
  const head = await fontText(`<span foreground="#FFFFFF">${esc(white)}</span>${gold ? `\n<span foreground="${GOLD}">${esc(gold)}</span>` : ''}`, BOLD, 'Montserrat Bold', 640, size);
  const headMeta = await sharp(head).metadata();
  const top = Math.max(150, Math.round((H - (headMeta.height || 300)) / 2) + 10);
  const layers: OverlayOptions[] = [
    { input: shade, left: 0, top: 0 },
    { input: head, left: 64, top },
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="5"><rect width="88" height="5" rx="2" fill="${GOLD}"/></svg>`), left: 66, top: Math.min(H - 40, top + (headMeta.height || 300) + 22) },
  ];
  try {
    layers.push({ input: await sharp(LOGO_WHITE).resize({ height: 84, fit: 'inside' }).png().toBuffer(), left: 58, top: 34 });
  } catch {}
  const out = sharp(base).composite(layers);
  return opts.png ? out.png().toBuffer() : out.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}


// Without a photo: a deep navy background with a soft city skyline, in the same design, plus the
// author. No API, so it is always available and looks the same on every server.
export async function makeCover(title: string, author?: string | null): Promise<Buffer> {
  const towers = [
    [640, 300, 60], [705, 230, 44], [752, 330, 70], [828, 180, 52], [884, 260, 64], [952, 140, 46], [1002, 280, 58], [1064, 210, 50], [1118, 300, 82],
  ]
    .map(([x, h, w]) => `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="#ffffff" fill-opacity="0.06"/>`)
    .join('');
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16244F"/><stop offset="1" stop-color="#0A1330"/></linearGradient>
        <radialGradient id="glow" cx="0.82" cy="0.35" r="0.55"><stop offset="0" stop-color="#E8B04B" stop-opacity="0.22"/><stop offset="1" stop-color="#E8B04B" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      ${towers}
      <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#E8B04B" fill-opacity="0.85"/>
    </svg>`
  );
  const base = await sharp(bg).png().toBuffer();
  const cover = await composeCover(base, title, { png: true });
  if (!author) return cover;
  const by = await fontText(`<span foreground="#C9D1E8">By ${esc(author)}</span>`, REGULAR, 'Montserrat', 700, 110);
  return sharp(cover).composite([{ input: by, left: 66, top: H - 70 }]).png().toBuffer();
}

// The cover's alt text: what the person wrote, else the title (never empty, so Google always has
// a description of the picture).
export function coverAlt(d: { cover_alt?: string | null; title?: string | null }): string {
  return String(d.cover_alt || d.title || 'Blog cover image').trim().slice(0, 200);
}

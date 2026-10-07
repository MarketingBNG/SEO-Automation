// Branded featured image for a blog that has none: 1200x630, company colours, the title, the
// author and the logo. Text is drawn with a font file shipped in the repo, so it renders the same on
// any server (no system fonts needed). No AI credits are used.
import path from 'path';
import sharp from 'sharp';

const FONT = path.join(process.cwd(), 'assets/fonts/Geist-Regular.ttf');
const LOGO = path.join(process.cwd(), 'public/logo.png');
const W = 1200;
const H = 630;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function text(markup: string, width: number, dpi: number) {
  return sharp({ text: { text: markup, font: 'Geist', fontfile: FONT, width, rgba: true, dpi, wrap: 'word' } }).png().toBuffer();
}

export async function makeCover(title: string, author?: string | null): Promise<Buffer> {
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B2A5E"/><stop offset="1" stop-color="#0F1838"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="80" y="150" width="96" height="8" rx="4" fill="#D7392E"/>
      <circle cx="1080" cy="560" r="220" fill="#ffffff" fill-opacity="0.04"/>
      <circle cx="1130" cy="90" r="120" fill="#5BB947" fill-opacity="0.08"/>
    </svg>`
  );
  const layers: { input: Buffer; left: number; top: number }[] = [];
  const t = await text(`<span foreground="#FFFFFF"><b>${esc(title.slice(0, 140))}</b></span>`, W - 200, 290);
  layers.push({ input: t, left: 80, top: 190 });
  if (author) layers.push({ input: await text(`<span foreground="#C9D1E8">By ${esc(author)}</span>`, 700, 110), left: 80, top: H - 110 });
  try {
    const logo = await sharp(LOGO).resize({ height: 84, fit: 'inside' }).png().toBuffer();
    layers.push({ input: logo, left: 80, top: 56 });
  } catch {
    layers.push({ input: await text('<span foreground="#FFFFFF"><b>USAIndiaCFO</b></span>', 500, 120), left: 80, top: 64 });
  }
  return sharp(bg).composite(layers).png().toBuffer();
}

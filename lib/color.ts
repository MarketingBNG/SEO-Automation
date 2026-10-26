// Colour maths for the Brand Palette (no AI involved, so the numbers can be trusted): WCAG contrast,
// OKLCH (a perceptual colour space: equal steps look equal), tint/shade scales, the most readable
// text colour, and the nearest accessible version of a colour. Pure functions.

export type RGB = { r: number; g: number; b: number }; // 0-255
export type OKLCH = { l: number; c: number; h: number }; // l 0-1, c 0-~0.37, h degrees

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const rgbToHex = ({ r, g, b }: RGB) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
export const normHex = (hex: string) => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
};

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// WCAG 2.x relative luminance and contrast ratio (1 to 21).
export function luminance(hex: string) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
// AA: 4.5 for normal text, 3 for large text (24px, or 18.5px bold) and UI parts; AAA: 7.
export const grade = (ratio: number) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fail');

// sRGB <-> OKLab <-> OKLCH (Björn Ottosson's matrices).
export function hexToOklch(hex: string): OKLCH | null {
  const c = hexToRgb(hex);
  if (!c) return null;
  const [r, g, b] = [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.sqrt(A * A + B * B), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l, c, h }: OKLCH) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return {
    r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}
const inGamut = ({ r, g, b }: { r: number; g: number; b: number }) => [r, g, b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// OKLCH -> hex; a colour outside what screens can show keeps its lightness and hue and loses chroma.
export function oklchToHex(col: OKLCH): string {
  let c = col.c;
  let lin = oklchToLinear({ ...col, c });
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...col, c: mid }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklchToLinear({ ...col, c });
  }
  return rgbToHex({ r: fromLinear(clamp(lin.r, 0, 1)), g: fromLinear(clamp(lin.g, 0, 1)), b: fromLinear(clamp(lin.b, 0, 1)) });
}

// Tint/shade scale 50 (lightest) to 950 (darkest) around one colour: same hue, perceptually even
// lightness steps, chroma eased off at the light and dark ends so tints do not turn chalky or neon.
export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const STEP_L: Record<number, number> = { 50: 0.975, 100: 0.945, 200: 0.89, 300: 0.81, 400: 0.72, 500: 0.63, 600: 0.54, 700: 0.46, 800: 0.38, 900: 0.3, 950: 0.22 };
export function scale(hex: string): { step: number; hex: string }[] {
  const base = hexToOklch(hex);
  if (!base) return [];
  // The base colour sits on its nearest step exactly as given.
  const nearest = SCALE_STEPS.reduce((best, s) => (Math.abs(STEP_L[s] - base.l) < Math.abs(STEP_L[best] - base.l) ? s : best), 500 as number);
  return SCALE_STEPS.map((step) => {
    if (step === nearest) return { step, hex: normHex(hex)! };
    const l = STEP_L[step];
    const ease = 1 - Math.min(1, Math.abs(l - 0.6) / 0.45) * 0.75;
    return { step, hex: oklchToHex({ l, c: base.c * ease, h: base.h }) };
  });
}

// The more readable of near-white and near-black text on a background.
export function textOn(bg: string, light = '#FFFFFF', dark = '#111111') {
  return contrast(light, bg) >= contrast(dark, bg) ? light : dark;
}

// The nearest version of `fg` (same hue and chroma, lightness moved away from the background) that
// reaches `target` contrast on `bg`. Returns the colour unchanged when it already passes.
export function accessible(fg: string, bg: string, target = 4.5): { hex: string; ratio: number; changed: boolean } {
  const start = contrast(fg, bg);
  if (start >= target) return { hex: normHex(fg)!, ratio: start, changed: false };
  const o = hexToOklch(fg);
  if (!o) return { hex: fg, ratio: start, changed: false };
  const darker = luminance(bg) > 0.18;
  for (let i = 1; i <= 100; i++) {
    const l = clamp(o.l + (darker ? -0.01 : 0.01) * i, 0, 1);
    const hex = oklchToHex({ ...o, l });
    const ratio = contrast(hex, bg);
    if (ratio >= target) return { hex, ratio, changed: true };
    if (l === 0 || l === 1) break;
  }
  const fallback = textOn(bg);
  return { hex: fallback, ratio: contrast(fallback, bg), changed: true };
}

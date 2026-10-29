// What changed between two versions of a blog, in numbers and plain words, with no AI call: which
// sentences were reworded, added or removed, whether numbers, headings, links, the FAQ or the call
// to action changed, and which words came in or went out. Pure functions (tests/content-diff.test.ts).

// section: the nearest H1/H2 above the unit; sub: the nearest heading of any level.
export type Unit = { kind: 'heading' | 'text'; text: string; norm: string; section: string; sub: string };
export type Sample = { type: 'reworded' | 'added' | 'removed'; before?: string; after?: string; heading?: boolean; numbers?: boolean };
export type ChangeReport = {
  kind: 'none' | 'light' | 'medium' | 'heavy';
  changedPct: number;
  wordsBefore: number;
  wordsAfter: number;
  sentencesBefore: number;
  sentencesAfter: number;
  unchanged: number;
  reworded: number;
  added: number;
  removed: number;
  headingsChanged: number;
  numbersChanged: number;
  linksAdded: string[];
  linksRemoved: string[];
  termsIn: string[];
  termsOut: string[];
  faqChanged: boolean;
  ctaChanged: boolean;
  titleChanged: boolean;
  metaChanged: boolean;
  samples: Sample[];
  summary: string;
};

type Version = { title?: string | null; meta?: string | null; html: string };

const MAX_UNITS = 1500;
const STOP = new Set('the a an and or but of to in on for with by from at as is are was were be been being this that these those it its into than then there their they them you your we our us not no yes can will would should could may might must also only more most such some any all each other both either neither which who whom whose what when where why how about over under after before while during between within without against through per via do does did done have has had having make makes made use used using get gets got new one two three first second last next same own very just even still back up down out off here now ever every many much few less least well way thing things if so because until unless since whether around across along among above below again further once'.split(' '));

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$₹.]+/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

// Headings and sentences of an article, in order, each knowing the heading it sits under.
export function units(html: string): Unit[] {
  const marked = String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => `\n\u0001${level}\u0002${inner}\n`)
    .replace(/<\/(p|li|tr|div|blockquote|td|th|figcaption)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const out: Unit[] = [];
  let section = '';
  let sub = '';
  for (const raw of decode(marked).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.startsWith('\u0001')) {
      const level = Number(line[1]) || 2;
      const text = line.slice(3).trim();
      if (!text) continue;
      if (level <= 2) section = text;
      sub = text;
      out.push({ kind: 'heading', text, norm: normalize(text), section, sub });
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?])\s+(?=["'(A-Z0-9₹$])/)) {
      const text = sentence.trim();
      if (text.length < 2) continue;
      const norm = normalize(text);
      if (!norm) continue;
      out.push({ kind: 'text', text, norm, section, sub });
    }
    if (out.length >= MAX_UNITS) break;
  }
  return out.slice(0, MAX_UNITS);
}

export const wordCount = (html: string) => units(html).reduce((n, u) => n + u.norm.split(' ').filter(Boolean).length, 0);

const numbersOf = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?%?/g) || []).map((n) => n.replace(/,/g, '')).sort().join('|');
const wordSet = (norm: string) => new Set(norm.split(' ').filter((w) => w.length > 2));
export function similarity(a: string, b: string) {
  const A = wordSet(a);
  const B = wordSet(b);
  if (!A.size && !B.size) return 1;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

// Longest common subsequence over normalized units; returns the pairs of matching indexes.
function lcsPairs(a: Unit[], b: Unit[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].norm === b[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].norm === b[j].norm) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const links = (html: string) => [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1].trim()).filter(Boolean);

function topTerms(us: Unit[]) {
  const freq = new Map<string, number>();
  for (const u of us) for (const w of u.norm.split(' ')) if (w.length >= 4 && !STOP.has(w) && !/^\d/.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return freq;
}

const isFaq = (u: Unit) => /\bfaq\b|frequently asked/i.test(`${u.section} ${u.sub}`);

const pct = (n: number, d: number) => (d ? Math.min(100, Math.round((100 * n) / d)) : n ? 100 : 0);

export function diffContent(before: Version, after: Version): ChangeReport {
  const a = units(before.html);
  const b = units(after.html);
  const pairs = lcsPairs(a, b);
  const matchedA = new Set(pairs.map((p) => p[0]));
  const matchedB = new Set(pairs.map((p) => p[1]));

  // Walk the gaps between matches: removed units from `a`, added units from `b`; the ones that look
  // alike are one reworded sentence.
  const samples: Sample[] = [];
  let reworded = 0;
  let added = 0;
  let removed = 0;
  let headingsChanged = 0;
  let numbersChanged = 0;
  let faqChanged = false;
  const bounds: [number, number][] = [...pairs, [a.length, b.length]];
  let ia = 0;
  let ib = 0;
  for (const [pa, pb] of bounds) {
    const gapA = a.slice(ia, pa);
    const gapB = b.slice(ib, pb);
    const usedB = new Set<number>();
    for (const ua of gapA) {
      let best = -1;
      let bestSim = 0.4;
      gapB.forEach((ub, k) => {
        if (usedB.has(k) || ub.kind !== ua.kind) return;
        const s = similarity(ua.norm, ub.norm);
        if (s > bestSim) {
          bestSim = s;
          best = k;
        }
      });
      if (best >= 0) {
        usedB.add(best);
        const ub = gapB[best];
        reworded++;
        const numbers = numbersOf(ua.text) !== numbersOf(ub.text);
        if (numbers) numbersChanged++;
        if (ua.kind === 'heading') headingsChanged++;
        if (isFaq(ua) || isFaq(ub)) faqChanged = true;
        samples.push({ type: 'reworded', before: ua.text, after: ub.text, heading: ua.kind === 'heading', numbers });
      } else {
        removed++;
        if (ua.kind === 'heading') headingsChanged++;
        if (/\d/.test(ua.text)) numbersChanged++;
        if (isFaq(ua)) faqChanged = true;
        samples.push({ type: 'removed', before: ua.text, heading: ua.kind === 'heading', numbers: /\d/.test(ua.text) });
      }
    }
    gapB.forEach((ub, k) => {
      if (usedB.has(k)) return;
      added++;
      if (ub.kind === 'heading') headingsChanged++;
      if (/\d/.test(ub.text)) numbersChanged++;
      if (isFaq(ub)) faqChanged = true;
      samples.push({ type: 'added', after: ub.text, heading: ub.kind === 'heading', numbers: /\d/.test(ub.text) });
    });
    ia = pa + 1;
    ib = pb + 1;
  }

  const unchanged = pairs.length;
  const changedPct = pct(reworded + added + removed, a.length + added);
  const linksA = new Set(links(before.html));
  const linksB = new Set(links(after.html));
  const linksAdded = [...linksB].filter((l) => !linksA.has(l));
  const linksRemoved = [...linksA].filter((l) => !linksB.has(l));

  const fa = topTerms(a);
  const fb = topTerms(b);
  const shift: [string, number][] = [];
  for (const w of new Set([...fa.keys(), ...fb.keys()])) shift.push([w, (fb.get(w) || 0) - (fa.get(w) || 0)]);
  const termsIn = shift.filter(([, d]) => d >= 2).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([w]) => w);
  const termsOut = shift.filter(([, d]) => d <= -2).sort((x, y) => x[1] - y[1]).slice(0, 6).map(([w]) => w);

  // The call to action is the last paragraph with a link (or the last sentence): changed when it
  // or the last link moved.
  const lastText = (us: Unit[]) => [...us].reverse().find((u) => u.kind === 'text')?.norm || '';
  const lastLink = (hs: string[]) => hs[hs.length - 1] || '';
  const ctaChanged = lastText(a) !== lastText(b) || lastLink([...linksA]) !== lastLink([...linksB]);

  const titleChanged = normalize(before.title || '') !== normalize(after.title || '');
  const metaChanged = normalize(before.meta || '') !== normalize(after.meta || '');
  const wordsBefore = a.reduce((n, u) => n + u.norm.split(' ').filter(Boolean).length, 0);
  const wordsAfter = b.reduce((n, u) => n + u.norm.split(' ').filter(Boolean).length, 0);

  const any = reworded + added + removed > 0 || titleChanged || metaChanged || linksAdded.length || linksRemoved.length;
  const kind: ChangeReport['kind'] = !any ? 'none' : changedPct < 5 ? 'light' : changedPct < 25 ? 'medium' : 'heavy';

  // Headings and numbers first in the samples, then the rest, at most 12.
  samples.sort((x, y) => Number(Boolean(y.heading)) - Number(Boolean(x.heading)) || Number(Boolean(y.numbers)) - Number(Boolean(x.numbers)));
  const report: ChangeReport = {
    kind,
    changedPct,
    wordsBefore,
    wordsAfter,
    sentencesBefore: a.length,
    sentencesAfter: b.length,
    unchanged,
    reworded,
    added,
    removed,
    headingsChanged,
    numbersChanged,
    linksAdded: linksAdded.slice(0, 10),
    linksRemoved: linksRemoved.slice(0, 10),
    termsIn,
    termsOut,
    faqChanged,
    ctaChanged: any ? ctaChanged : false,
    titleChanged,
    metaChanged,
    samples: samples.slice(0, 12),
    summary: '',
  };
  report.summary = summarize(report);
  return report;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One short paragraph a reviewer can read at a glance. No em dashes.
export function summarize(r: ChangeReport): string {
  if (r.kind === 'none') return 'No change to the words.';
  const parts: string[] = [];
  const edits: string[] = [];
  if (r.reworded) edits.push(`${plural(r.reworded, 'sentence')} reworded`);
  if (r.added) edits.push(`${r.added} added`);
  if (r.removed) edits.push(`${r.removed} removed`);
  parts.push(edits.length ? `Changed ${r.changedPct}% of the text: ${edits.join(', ')}.` : 'The article text is the same.');
  const words = r.wordsAfter - r.wordsBefore;
  if (Math.abs(words) >= 20) parts.push(`${words > 0 ? `${words} words longer` : `${-words} words shorter`} (${r.wordsBefore} to ${r.wordsAfter}).`);
  if (r.numbersChanged) parts.push(`${plural(r.numbersChanged, 'number, date or figure', 'numbers, dates or figures')} changed: re-verify them.`);
  if (r.headingsChanged) parts.push(`${plural(r.headingsChanged, 'heading')} changed.`);
  if (r.faqChanged) parts.push('The FAQ changed.');
  if (r.linksAdded.length || r.linksRemoved.length) parts.push(`Links: ${r.linksAdded.length} added, ${r.linksRemoved.length} removed.`);
  if (r.ctaChanged) parts.push('The call to action changed.');
  if (r.titleChanged) parts.push('The title changed.');
  if (r.metaChanged) parts.push('The meta description changed.');
  if (r.termsIn.length) parts.push(`Words used more: ${r.termsIn.join(', ')}.`);
  if (r.termsOut.length) parts.push(`Words used less: ${r.termsOut.join(', ')}.`);
  return parts.join(' ');
}

// How alike two articles are (0 to 1), for spotting a re-upload of the same piece.
export function articleSimilarity(htmlA: string, htmlB: string) {
  const a = new Set(units(htmlA).map((u) => u.norm));
  const b = new Set(units(htmlB).map((u) => u.norm));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const s of a) if (b.has(s)) common++;
  return common / Math.min(a.size, b.size);
}

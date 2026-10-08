// Plagiarism check. Each blog is compared, phrase by phrase, with the pages ranking on Google for
// its keyword (US and India) and with our own published blogs. Copied phrases are found with
// 8-word shingles; a run of 25 or more words in a row that matches a source, or more than 8% of
// the blog's phrases shared with one source, fails the check and the blog does not publish until
// the passages are rewritten. With COPYSCAPE_USERNAME and COPYSCAPE_API_KEY set, Copyscape also
// searches the whole web.
import prisma from './prisma';
import { liveSearch } from './serphouse';

const N = 8;
export const MAX_SHARE = 0.08;
export const MAX_RUN = 25;
const OWN_HOST = () => new URL(process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').hostname.replace(/^www\./, '');
const SKIP = /(youtube|reddit|quora|facebook|linkedin|instagram|twitter|x)\.com|\.pdf($|\?)/i;

export function plainText(html: string): string {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|li|h[1-6]|td|th|tr|div|blockquote)>/gi, ' . ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

export const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9%$₹.\s-]/g, ' ').replace(/\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean);

function shingleSet(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + N <= ws.length; i++) out.add(ws.slice(i, i + N).join(' '));
  return out;
}

export type Match = { source: string; share: number; longestRun: number; sample: string };

// Pure: how much of `draft` appears in `source`.
export function compare(draftText: string, sourceText: string, source: string): Match {
  const d = words(draftText);
  const src = shingleSet(words(sourceText));
  if (d.length < N || !src.size) return { source, share: 0, longestRun: 0, sample: '' };
  let hits = 0;
  let run = 0;
  let best = 0;
  let bestEnd = 0;
  for (let i = 0; i + N <= d.length; i++) {
    if (src.has(d.slice(i, i + N).join(' '))) {
      hits++;
      run = run ? run + 1 : N;
      if (run > best) {
        best = run;
        bestEnd = i + N;
      }
    } else run = 0;
  }
  const total = d.length - N + 1;
  return { source, share: Math.round((hits / total) * 1000) / 1000, longestRun: best, sample: best ? d.slice(bestEnd - best, bestEnd).join(' ').slice(0, 300) : '' };
}

export const failed = (m: Match) => m.share > MAX_SHARE || m.longestRun >= MAX_RUN;

async function pageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; USAIndiaCFO-SEO/1.0)' } });
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    const main = html.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0] || html;
    return plainText(main);
  } catch {
    return null;
  }
}

function organic(serp: any): string[] {
  const list = serp?.results?.results?.organic || serp?.results?.organic || [];
  return (Array.isArray(list) ? list : []).map((r: any) => String(r.link || r.url || '')).filter((u: string) => /^https?:\/\//.test(u));
}

async function copyscape(text: string): Promise<Match[]> {
  const u = process.env.COPYSCAPE_USERNAME;
  const k = process.env.COPYSCAPE_API_KEY;
  if (!u || !k) return [];
  const body = new URLSearchParams({ u, k, o: 'csearch', e: 'UTF-8', t: text.slice(0, 25000), f: 'json', c: '5' });
  const res = await fetch('https://www.copyscape.com/api/', { method: 'POST', body, signal: AbortSignal.timeout(60000) });
  const j: any = await res.json().catch(() => null);
  if (!j || j.error) throw new Error(`Copyscape: ${j?.error || res.status}`);
  const total = Number(j.querywords) || 1;
  return (j.result || []).map((r: any) => ({ source: r.url, share: Math.round((Number(r.minwordsmatched || 0) / total) * 1000) / 1000, longestRun: Number(r.minwordsmatched || 0), sample: String(r.textsnippet || '').slice(0, 300) }));
}

export type OriginalityResult = { ok: boolean; checkedAt: string; sources: number; matches: Match[]; worst: Match | null; note?: string; copyscape?: boolean };

// Checks one blog against the live top results for its keyword and our own published blogs.
export async function checkOriginality({ html, keyword, excludeDraftId, excludeUrl }: { html: string; keyword: string; excludeDraftId?: number; excludeUrl?: string | null }): Promise<OriginalityResult> {
  const text = plainText(html);
  const own = OWN_HOST();
  const urls = new Set<string>();
  if (process.env.SERPHOUSE_API_KEY && keyword) {
    const [us, india] = await Promise.all([liveSearch({ q: keyword, loc: 'United States' }).catch(() => null), liveSearch({ q: keyword, loc: 'India', device: 'mobile' }).catch(() => null)]);
    for (const u of [...organic(us).slice(0, 10), ...organic(india).slice(0, 10)]) {
      try {
        if (!SKIP.test(u) && new URL(u).hostname.replace(/^www\./, '') !== own) urls.add(u);
      } catch {}
    }
  }
  const matches: Match[] = [];
  const pages = await Promise.all([...urls].slice(0, 15).map(async (u) => ({ u, t: await pageText(u) })));
  for (const p of pages) if (p.t) matches.push(compare(text, p.t, p.u));
  // Our own blogs: two posts saying the same thing compete with each other in Google.
  const ownPosts = await prisma.drafts.findMany({ where: { status: 'published', ...(excludeDraftId ? { id: { not: excludeDraftId } } : {}) }, select: { content_html: true, wp_post_url: true, title: true }, orderBy: { id: 'desc' }, take: 200 });
  for (const d of ownPosts) if (d.wp_post_url !== excludeUrl) matches.push(compare(text, plainText(d.content_html || ''), d.wp_post_url || `our draft "${d.title}"`));
  let usedCopyscape = false;
  let note: string | undefined;
  try {
    const cs = await copyscape(text);
    if (process.env.COPYSCAPE_USERNAME) usedCopyscape = true;
    matches.push(...cs.filter((m) => !m.source.includes(own)));
  } catch (e: any) {
    note = e.message;
  }
  const checked = pages.filter((p) => p.t).length + ownPosts.length;
  const ranked = matches.filter((m) => m.share > 0 || m.longestRun > 0).sort((a, b) => b.longestRun - a.longestRun || b.share - a.share);
  const bad = ranked.filter(failed);
  if (!pages.some((p) => p.t) && !usedCopyscape) note = [note, 'No Google results could be read (SERPHouse not connected or pages blocked), so only our own blogs were compared.'].filter(Boolean).join(' ');
  return { ok: bad.length === 0, checkedAt: new Date().toISOString(), sources: checked, matches: (bad.length ? bad : ranked).slice(0, 5), worst: ranked[0] || null, note, copyscape: usedCopyscape };
}

// Runs the check for a draft and saves the result with it.
export async function checkDraftOriginality(draftId: number): Promise<OriginalityResult | null> {
  const d: any = await prisma.drafts.findUnique({ where: { id: draftId }, include: { keyword: { select: { keyword: true } } } });
  if (!d) return null;
  const r = await checkOriginality({ html: d.content_html || '', keyword: d.keyword?.keyword || d.title || '', excludeDraftId: d.id, excludeUrl: d.wp_post_url });
  await prisma.drafts.update({ where: { id: draftId }, data: { originality: JSON.stringify({ ...r, stamp: d.updated_at }) } });
  return r;
}

// The saved result if it still matches the text, else a fresh check.
export async function ensureOriginality(draftId: number): Promise<OriginalityResult | null> {
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, select: { originality: true, updated_at: true } });
  if (!d) return null;
  try {
    const saved = d.originality ? JSON.parse(d.originality) : null;
    if (saved && saved.stamp === d.updated_at) return saved;
  } catch {}
  return checkDraftOriginality(draftId);
}

export function originalityReason(r: OriginalityResult): string {
  const m = r.matches[0];
  return `Plagiarism check: ${m ? `${m.longestRun} words in a row (${Math.round(m.share * 100)}% of the blog) match ${m.source}` : 'copied text found'}. Rewrite those passages in your own words, then check again.`;
}

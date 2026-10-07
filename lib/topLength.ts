// Rule 8 "length fits the topic": counts the words on the pages ranking now for a keyword (US and
// India results from the research brief) and turns them into a target range for the writer.
import { lengthTarget } from './strategy/core';

const OWN = /usaindiacfo\.com/i;
const SKIP = /(youtube|reddit|quora|facebook|linkedin|instagram|twitter|x)\.com|\.pdf($|\?)/i;

function organicUrls(serp: any): string[] {
  const list = serp?.results?.results?.organic || serp?.results?.organic || [];
  return (Array.isArray(list) ? list : []).map((r: any) => String(r.link || r.url || '')).filter((u: string) => /^https?:\/\//.test(u));
}

export function visibleWords(html: string): number {
  const body = String(html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return body.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

async function wordsAt(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; USAIndiaCFO-SEO/1.0)' } });
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return null;
    return visibleWords(await res.text());
  } catch {
    return null;
  }
}

export async function topResultsLength(brief: any, fallback = 1600) {
  const urls = [...new Set([...organicUrls(brief?.serp).slice(0, 5), ...organicUrls(brief?.serpIndia).slice(0, 5)])].filter((u) => !OWN.test(u) && !SKIP.test(u)).slice(0, 8);
  const counts = (await Promise.all(urls.map(wordsAt))).filter((n): n is number => typeof n === 'number');
  return { ...lengthTarget(counts, fallback), urls: urls.length };
}

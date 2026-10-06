// @ts-nocheck -- reads untyped analysis JSON.
// Finds our real business competitors without anyone typing a list: the domains that keep showing in
// Google's top results for our tracked keywords (from the site analysis), minus government, reference,
// forum and big media sites, then Claude keeps only firms that sell services like ours.
// Saved in settings (competitor_domains_auto) and refreshed each time a strategy is built.
import * as settings from './settings';
import { callClaude } from './anthropic';
import { liveSearch } from './serphouse';

// Sites that rank for everything but never compete for clients.
const NOT_COMPETITORS = /(\.gov(\.\w+)?|\.gov\.in|\.nic\.in|\.edu|wikipedia\.org|reddit\.com|quora\.com|youtube\.com|linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|medium\.com|forbes\.com|investopedia\.com|nerdwallet\.com|cleartax\.in|economictimes\.indiatimes\.com|livemint\.com|business-standard\.com|moneycontrol\.com|thehindu\.com|hindustantimes\.com|google\.com|amazon\.com|indeed\.com|glassdoor\.\w+|github\.com|stackexchange\.com)$/i;

export function candidateDomains(searchCompetitors: any[] = [], ourHost = '') {
  return (searchCompetitors || [])
    .map((c) => ({ domain: String(c.domain || '').toLowerCase().replace(/^www\./, ''), seen: c.top5Appearances || 0 }))
    .filter((c) => c.domain && c.domain !== ourHost && !c.domain.endsWith(`.${ourHost}`) && !NOT_COMPETITORS.test(c.domain));
}

export async function detectCompetitors(searchCompetitors: any[], ourHost: string, { classify = classifyWithClaude } = {}) {
  const candidates = candidateDomains(searchCompetitors, ourHost);
  if (!candidates.length) return [];
  let picked = candidates.map((c) => c.domain);
  try {
    const kept = await classify(candidates);
    if (Array.isArray(kept) && kept.length) picked = picked.filter((d) => kept.includes(d));
  } catch {
    // Keep the filtered list when the check is not possible.
  }
  picked = picked.slice(0, 8);
  await settings.set('competitor_domains_auto', picked.join(','));
  await settings.set('competitor_domains_auto_at', new Date().toISOString().slice(0, 10));
  return picked;
}

async function classifyWithClaude(candidates) {
  const { text } = await callClaude(
    `You pick the business competitors of usaindiacfo.com, a firm selling cross-border CFO, accounting, tax, company formation and compliance services for US and India businesses.
From the domains given (they rank in Google for our keywords), keep ONLY firms that sell similar professional services to clients. Drop news, government, software products, directories, forums and general publishers. Check a domain with a web search if unsure.
Return ONLY the kept domains, comma separated, nothing else.`,
    [{ role: 'user', content: candidates.map((c) => `${c.domain} (in top 5 for ${c.seen} of our keywords)`).join('\n') }],
    undefined,
    { maxUses: 5, effort: 'medium', feature: 'competitors' }
  );
  return text.toLowerCase().split(/[\s,]+/).map((d) => d.replace(/^www\./, '').trim()).filter((d) => /\./.test(d));
}

// The list the strategy uses: the one typed in Settings wins; otherwise the detected one.
export async function competitorList() {
  const typed = String((await settings.get('competitor_domains')) || '').split(/[\s,]+/).filter(Boolean);
  if (typed.length) return { domains: typed, source: 'Settings' };
  const auto = String((await settings.get('competitor_domains_auto')) || '').split(/[\s,]+/).filter(Boolean);
  return { domains: auto, source: auto.length ? `detected automatically on ${(await settings.get('competitor_domains_auto_at')) || 'an earlier run'}` : 'none' };
}

// Quick check without a full strategy run: who is in Google's top 5 for our main keywords
// (SERPHouse, US results, a few keywords only). Returns rows shaped like the site analysis output.
export async function searchCompetitorsFromSerp(keywords: string[], ourHost: string, { search = liveSearch } = {}) {
  const counts: Record<string, number> = {};
  for (const q of keywords.slice(0, 8)) {
    try {
      const json: any = await search({ q, loc: 'United States', timeoutMs: 90000 });
      for (const r of (json.results?.results?.organic || []).slice(0, 5)) {
        let h = '';
        try {
          h = new URL(r.link).hostname.replace(/^www\./, '');
        } catch {}
        if (h && !h.endsWith(ourHost)) counts[h] = (counts[h] || 0) + 1;
      }
    } catch {
      // One failed search does not stop the others.
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([domain, top5Appearances]) => ({ domain, top5Appearances }));
}

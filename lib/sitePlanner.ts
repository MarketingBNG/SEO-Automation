// Website Planner (temporary, admin only): plans the new company website from the dashboard's own
// data (Search Console searches and pages, the approved strategy's keywords, the services, the
// current site's pages) plus web research on competitors: which pages, which sections on each
// page and in what order, the navigation tabs, and the full copy for every section. The home page
// opens with one clear line that explains the business. Runs in the background; the result is
// kept in settings and downloads as a Word file.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { parseJson } from './strategy/generate';
import { startTimer, endTimer } from './jobTimer';

// The section is switched off after this moment (24 hours from release).
export const PLANNER_UNTIL = Date.parse(process.env.SITE_PLANNER_UNTIL || '2026-10-10T18:30:00Z');
export const plannerOpen = (now = Date.now()) => now < PLANNER_UNTIL;

const g = globalThis as unknown as { __sitePlanRun?: boolean };

async function gatherInputs() {
  const out: any = {};
  try {
    const { querySearchAnalytics, comparisonRanges } = await import('./searchConsole');
    const { current } = comparisonRanges(90);
    out.searches = (await querySearchAnalytics({ ...current, dimensions: ['query'], rowLimit: 60 })).map((r: any) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position) }));
    out.pages = (await querySearchAnalytics({ ...current, dimensions: ['page'], rowLimit: 30 })).map((r: any) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions }));
  } catch (e: any) {
    out.searchConsoleError = e.message;
  }
  try {
    const { wpRequest } = await import('./wordpress');
    const { json } = await wpRequest('GET', '/wp/v2/pages', { query: { per_page: 100, _fields: 'title,link' } });
    out.currentPages = (json || []).map((p: any) => ({ title: String(p.title?.rendered || '').replace(/<[^>]+>/g, ''), url: p.link }));
  } catch (e: any) {
    out.wordpressError = e.message;
  }
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (s?.plan_json) {
    const plan = JSON.parse(s.plan_json);
    out.strategyKeywords = (plan.keywords || []).slice(0, 40).map((k: any) => k.keyword);
    out.strategySummary = String(plan.summary?.text || plan.summary || '').slice(0, 1500);
  }
  out.services = String((await settings.get('focus_services')) || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  return out;
}

const SYSTEM = `You are a senior website strategist and conversion copywriter for USAIndiaCFO (usaindiacfo.com), a cross-border finance, tax, accounting and compliance firm for Indian founders with US companies, US companies with Indian subsidiaries, and NRIs. You plan the company's NEW website: the pages, the sections on each page in order, the main navigation tabs, and the final copy for every section. Ground every choice in the data given (what people search for, which pages already earn clicks, the services, the strategy keywords) and in web research on 4 to 6 direct competitors' websites (look at their home pages and service pages). Rules: the home page hero opens with ONE clear headline line (under 12 words) that says what the business does and for whom, then a one-sentence subline and the primary call to action. Plain, specific, credible words; no hype, no AI filler, no em dashes. Never invent facts, client names, numbers, awards or testimonials: where real proof is needed write a bracketed note for the team, e.g. [Add 3 real client quotes with name, company and permission]. Write in English.`;

export async function runSitePlan(actor?: string | null, brief = '') {
  if (g.__sitePlanRun) throw Object.assign(new Error('A plan is already being made.'), { status: 409 });
  g.__sitePlanRun = true;
  const key = 'site-plan';
  startTimer(key, 'strategy', 'Website plan');
  await settings.set('site_plan_status', JSON.stringify({ state: 'running', startedAt: new Date().toISOString() }));
  try {
    const inputs = await gatherInputs();
    const prompt = `DATA FROM THE DASHBOARD (JSON):\n${JSON.stringify(inputs).slice(0, 60000)}\n\n${brief ? `NOTES FROM THE TEAM: ${brief}\n\n` : ''}Research the competitors, then return ONLY JSON between ===JSON=== and ===END===:
{"hero":{"headline":"...","subline":"...","primaryCta":"...","secondaryCta":"...","why":"why this line, from the data"},
 "navigation":[{"tab":"...","links_to":"page name","children":["..."]}],
 "pages":[{"name":"Home","slug":"/","purpose":"...","primaryKeyword":"...","sections":[{"name":"Hero","purpose":"...","layout":"what it looks like: columns, cards, image, form","content":"the final copy as HTML (<h2>, <h3>, <p>, <ul>), ready to paste"}]}],
 "competitors":[{"name":"...","url":"https://...","takeaway":"what to learn or avoid"}],
 "notes":["things the team must supply: photos, client quotes, numbers, licences"]}
Plan every page the new site needs (at least: Home, About Us, each core service, Pricing or How we work, Resources/Blog, FAQ, Contact; add Testimonials, Events or Webinars, Careers, Industries or Case studies only where they earn their place). For each page give every section in order with its full copy.`;
    const { text } = (await callClaude(SYSTEM, [{ role: 'user', content: prompt }], undefined, { maxUses: 15, effort: 'high', feature: 'strategy' })) as { text: string };
    const plan = parseJson(text);
    await settings.set('site_plan', JSON.stringify({ ...plan, inputsUsed: { searches: inputs.searches?.length || 0, pages: inputs.pages?.length || 0, currentPages: inputs.currentPages?.length || 0, keywords: inputs.strategyKeywords?.length || 0, errors: [inputs.searchConsoleError, inputs.wordpressError].filter(Boolean) }, madeAt: new Date().toISOString() }));
    await settings.set('site_plan_status', JSON.stringify({ state: 'ready', at: new Date().toISOString() }));
    await activity.log('siteplan.generated', { details: `${(plan.pages || []).length} pages planned`, actor });
    await endTimer(key, true);
  } catch (e: any) {
    await settings.set('site_plan_status', JSON.stringify({ state: 'failed', error: String(e?.message || e).slice(0, 300), at: new Date().toISOString() }));
    await activity.log('siteplan.failed', { details: String(e?.message || e).slice(0, 200), actor });
    await endTimer(key, false);
  } finally {
    g.__sitePlanRun = false;
  }
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function planHtml(p: any): string {
  const parts: string[] = [`<h1>New website plan: USAIndiaCFO</h1><p><em>Made ${esc(new Date(p.madeAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST from the dashboard's data and competitor research.</em></p>`];
  if (p.hero) parts.push(`<h2>Home page hero</h2><p><strong>Headline:</strong> ${esc(p.hero.headline)}</p><p><strong>Subline:</strong> ${esc(p.hero.subline)}</p><p><strong>Buttons:</strong> ${esc(p.hero.primaryCta)}${p.hero.secondaryCta ? ` / ${esc(p.hero.secondaryCta)}` : ''}</p><p><em>Why: ${esc(p.hero.why)}</em></p>`);
  if (p.navigation?.length) parts.push(`<h2>Navigation tabs</h2><ul>${p.navigation.map((n: any) => `<li><strong>${esc(n.tab)}</strong>${n.children?.length ? `: ${n.children.map(esc).join(', ')}` : ''}</li>`).join('')}</ul>`);
  parts.push(`<h2>Pages at a glance</h2><table border="1"><tr><th>Page</th><th>Address</th><th>Sections</th><th>Purpose</th></tr>${(p.pages || []).map((pg: any) => `<tr><td>${esc(pg.name)}</td><td>${esc(pg.slug)}</td><td>${(pg.sections || []).length}</td><td>${esc(pg.purpose)}</td></tr>`).join('')}</table>`);
  for (const pg of p.pages || []) {
    parts.push(`<h2>${esc(pg.name)} (${esc(pg.slug)})</h2><p><strong>Purpose:</strong> ${esc(pg.purpose)}${pg.primaryKeyword ? ` <strong>Main keyword:</strong> ${esc(pg.primaryKeyword)}` : ''}</p>`);
    (pg.sections || []).forEach((s: any, i: number) => {
      const content = String(s.content || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<(\/?)h[12]\b/gi, '<$1h4');
      parts.push(`<h3>${i + 1}. ${esc(s.name)}</h3><p><em>${esc(s.purpose)}${s.layout ? `. Layout: ${esc(s.layout)}` : ''}</em></p>${content}`);
    });
  }
  if (p.competitors?.length) parts.push(`<h2>Competitors looked at</h2><ul>${p.competitors.map((c: any) => `<li><strong>${esc(c.name)}</strong> (${esc(c.url)}): ${esc(c.takeaway)}</li>`).join('')}</ul>`);
  if (p.notes?.length) parts.push(`<h2>What the team must supply</h2><ul>${p.notes.map((n: any) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  return parts.join('');
}

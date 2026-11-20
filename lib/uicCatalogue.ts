// "Know UIC": the small catalogue of USAIndiaCFO's services the training uses, so every lesson about
// the firm describes the same services the same way. Built ONLY from the firm's own content: the
// service pages in Website Content (site_content), the process / about pages there, the service
// calls to action an admin typed in Settings (service_ctas), and the titles of live blog posts read
// through the website connector (lib/site.ts). Nothing is invented: a service with no page or link on
// usaindiacfo.com is left out, and the lesson about a service is skipped when its page cannot be read.
// Rebuilt at most once a week (stored in settings as uic_catalogue).
import prisma from './prisma';
import * as settings from './settings';
import { publicSite } from './siteConnector';

export type UicService = { name: string; url: string; summary: string; source: string; posts: string[] };
export type UicCatalogue = { builtAt: string; services: UicService[]; process: { title: string; url: string; text: string }[]; sources: string[] };

const KEY = 'uic_catalogue';
const WEEK_MS = 7 * 86400000;
const text = (html: string) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SERVICE_SLUG = /^\/(services?|solutions?)(\/|$)/i;
const PROCESS_SLUG = /^\/(about(-us)?|how-(we|it)-works?|process|our-process|approach|why-us)(\/|$)/i;
// Only the firm's own addresses count as a source for a service.
export const isUicUrl = (u: string) => /^https?:\/\/(www\.)?usaindiacfo\.com(\/|$)/i.test(String(u || '').trim());

function sectionsText(sections: string | null) {
  try {
    const s = JSON.parse(sections || '{}');
    return Object.values(s)
      .map((v: any) => [v?.heading, text(v?.html || ''), Array.isArray(v?.items) ? v.items.map((i: any) => (typeof i === 'string' ? i : `${i?.title || ''} ${text(i?.text || i?.html || '')}`)).join('. ') : ''].filter(Boolean).join('. '))
      .join(' ');
  } catch {
    return '';
  }
}

export type CatalogueSources = {
  pages: () => Promise<{ slug: string; title: string; meta_description: string | null; sections: string | null; html: string | null }[]>;
  ctas: () => Promise<string | null>;
  posts: () => Promise<{ title: string; link: string }[]>;
};

const defaultSources: CatalogueSources = {
  pages: () => prisma.site_content.findMany({ where: { type: 'page', status: 'published' }, select: { slug: true, title: true, meta_description: true, sections: true, html: true } }),
  ctas: () => settings.get('service_ctas'),
  posts: async () => {
    const { livePosts, siteConfigured } = await import('./site');
    if (!siteConfigured()) return [];
    return (await livePosts()).map((p) => ({ title: p.title, link: p.link }));
  },
};

const words = (s: string) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['and', 'for', 'the', 'services', 'service', 'with', 'india', 'usa'].includes(w));

export async function buildCatalogue(src: CatalogueSources = defaultSources, now = new Date()): Promise<UicCatalogue> {
  const site = publicSite().replace(/\/+$/, '');
  const base = isUicUrl(site) ? site : 'https://usaindiacfo.com';
  const pages = await src.pages().catch(() => []);
  const posts = await src.posts().catch(() => []);
  const services: UicService[] = [];
  const seen = new Set<string>();
  const add = (s: Omit<UicService, 'posts'>) => {
    const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key) || !isUicUrl(s.url)) return;
    seen.add(key);
    const w = words(s.name);
    services.push({ ...s, posts: posts.filter((p) => w.some((x) => words(p.title).includes(x))).slice(0, 5).map((p) => p.title) });
  };
  for (const p of pages.filter((p) => SERVICE_SLUG.test(p.slug) && p.slug.split('/').filter(Boolean).length >= 2)) {
    add({ name: String(p.title).slice(0, 120), url: `${base}${p.slug}`, summary: [p.meta_description, sectionsText(p.sections), text(p.html || '')].filter(Boolean).join(' ').slice(0, 900), source: `Website Content page ${p.slug}` });
  }
  let ctas: any[] = [];
  try {
    ctas = JSON.parse((await src.ctas().catch(() => null)) || '[]');
  } catch {
    ctas = [];
  }
  for (const c of Array.isArray(ctas) ? ctas : []) {
    if (c?.service && c?.url) add({ name: String(c.service).slice(0, 120), url: String(c.url), summary: String(c.text || '').slice(0, 400), source: 'Settings > service calls to action' });
  }
  const process = pages.filter((p) => PROCESS_SLUG.test(p.slug)).map((p) => ({ title: p.title, url: `${base}${p.slug}`, text: [p.meta_description, sectionsText(p.sections), text(p.html || '')].filter(Boolean).join(' ').slice(0, 1500) }));
  return { builtAt: now.toISOString(), services, process, sources: [...new Set([...services.map((s) => s.source), ...process.map((p) => `Website Content page ${p.url.replace(base, '')}`), posts.length ? `${posts.length} live blog posts (titles)` : ''].filter(Boolean))] };
}

export async function getCatalogue({ refresh = false, now = new Date(), src }: { refresh?: boolean; now?: Date; src?: CatalogueSources } = {}): Promise<UicCatalogue> {
  let have: UicCatalogue | null = null;
  try {
    have = JSON.parse((await settings.get(KEY)) || 'null');
  } catch {
    have = null;
  }
  if (have && !refresh && now.getTime() - Date.parse(have.builtAt) < WEEK_MS) return have;
  const fresh = await buildCatalogue(src, now);
  await settings.set(KEY, JSON.stringify(fresh));
  return fresh;
}

// The service a day's Know UIC lesson is about: the services take turns, so over time every one is
// covered. null when the catalogue is empty (the lesson then finds a service page itself or is skipped).
export function serviceForDay(cat: UicCatalogue, day: string, offset = 0): UicService | null {
  if (!cat.services.length) return null;
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000) + offset;
  return cat.services[((n % cat.services.length) + cat.services.length) % cat.services.length];
}

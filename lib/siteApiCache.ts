// The website's read API (/api/site/v1 pages and posts): the same answer is kept in memory and
// reused until a page or post changes here (upsertContent, delete), and for at most
// SITE_API_CACHE_MS (default 30 s) in case the table is changed some other way. A website that
// asks for a post on every visit, or a crawl of the site, then costs no database work per request.
// The key is checked on every request before this is used.
import { NextResponse } from 'next/server';

type Entry = { at: number; gen: number; status: number; body: unknown };
const g = globalThis as unknown as { __siteApi?: { gen: number; map: Map<string, Entry>; loading: Map<string, Promise<Entry>> } };
const store = (g.__siteApi ||= { gen: 0, map: new Map(), loading: new Map() });
const TTL = () => {
  const v = process.env.SITE_API_CACHE_MS;
  return v && Number(v) >= 0 ? Number(v) : 30_000;
};

export async function siteRead(req: Request, compute: () => Promise<{ status: number; body: unknown }>) {
  const u = new URL(req.url);
  const key = u.pathname + u.search;
  const hit = store.map.get(key);
  if (hit && hit.gen === store.gen && Date.now() - hit.at < TTL()) return NextResponse.json(hit.body, { status: hit.status });
  let job = store.loading.get(key);
  if (!job) {
    const gen = store.gen;
    job = compute()
      .then((r) => {
        const e: Entry = { at: Date.now(), gen, status: r.status, body: r.body };
        // Kept only if nothing changed while it was read.
        if (gen === store.gen && (r.status === 200 || r.status === 404)) {
          store.map.set(key, e);
          if (store.map.size > 1000) store.map.delete(store.map.keys().next().value as string);
        }
        return e;
      })
      .finally(() => store.loading.delete(key));
    store.loading.set(key, job);
  }
  const e = await job;
  return NextResponse.json(e.body, { status: e.status });
}

// A page or post was saved or deleted: every kept answer is dropped at once.
export function siteContentChanged() {
  store.gen++;
  store.map.clear();
  store.loading.clear();
}

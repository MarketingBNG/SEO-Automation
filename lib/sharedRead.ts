// One answer for many readers: lists that are the same for everyone (Home, the Blog Calendar, the
// status light, AI credits) are worked out once and the same JSON is sent to everyone who asks
// within the next few seconds, instead of each open tab running the same 10 to 20 queries.
//
// Nothing a person does is hidden by it: any change made through the server (every POST, PUT, PATCH
// or DELETE, and the scheduled jobs under /api/cron) drops every kept answer when it starts and again
// when it ends, so the next read after an action is worked out fresh. Work the server does on its
// own (the scheduler, a blog being written) shows up within the few seconds, as with polling.
// The counter is kept by the request hook in lib/overload.ts.
import type http from 'node:http';

type Entry = { writes: number; at: number; text?: string; job?: Promise<string> };
const g = globalThis as unknown as { __sharedRead?: { writes: number; map: Map<string, Entry> } };
const st = (g.__sharedRead ||= { writes: 0, map: new Map() });

const changes = (method: string | undefined, url: string | undefined) => (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') || (url || '').startsWith('/api/cron/');

// Called for every request the server receives (lib/overload.ts).
export function noteRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!changes(req.method, req.url)) return;
  st.writes++;
  st.map.clear();
  res.once('close', () => {
    st.writes++;
    st.map.clear();
  });
}

// For code that changes data outside a request and wants it seen at once (and for tests).
export function dropSharedReads() {
  st.writes++;
  st.map.clear();
}

// The JSON text of compute(), shared for ttlMs by everyone asking with the same key.
export async function sharedJson(key: string, ttlMs: number, compute: () => Promise<unknown>): Promise<string> {
  const hit = st.map.get(key);
  if (hit && hit.writes === st.writes) {
    if (hit.text !== undefined && Date.now() - hit.at < ttlMs) return hit.text;
    if (hit.job) return hit.job;
  }
  const entry: Entry = { writes: st.writes, at: 0 };
  entry.job = compute()
    .then((v) => JSON.stringify(v))
    .then((text) => {
      // Kept only when nothing changed while it was worked out.
      if (st.map.get(key) === entry && entry.writes === st.writes) Object.assign(entry, { text, at: Date.now(), job: undefined });
      return text;
    })
    .catch((e) => {
      if (st.map.get(key) === entry) st.map.delete(key);
      throw e;
    });
  st.map.set(key, entry);
  return entry.job;
}

export function jsonResponse(text: string, status = 200) {
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

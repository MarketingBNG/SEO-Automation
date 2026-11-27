// Overload guard: when the server is already behind, a new read is answered at once with 503 and
// "try again in a few seconds" instead of joining a queue where every request waits longer and
// longer until browsers and Cloudflare give up (a pile-up that also kept the server busy with work
// nobody was waiting for any more). Installed once per server process from instrumentation.ts.
//
// "Behind" means: the requests that finished recently took over OVERLOAD_TARGET_MS on average
// (default 10 s) while more than OVERLOAD_MIN_INFLIGHT (default 64) are open, or more than
// OVERLOAD_MAX_INFLIGHT (default 1500) requests are open at all. Never refused: writes (POST, PATCH,
// ...: a person's action is not dropped), sign-in (/api/auth), scheduled jobs (/api/cron), the
// website API (/api/site/v1) and Next's static files.
//
// The refusal is sent after OVERLOAD_HOLD_MS (default 1 s; it costs only a timer): a client or bot
// that asks again the moment it is refused would otherwise turn the refusals into thousands of
// requests a second and keep the server busy on its own.
import http from 'node:http';
import { noteRequest } from './sharedRead';

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export type OverloadState = { inflight: number; avgMs: number; shed: number };

const g = globalThis as unknown as { __seoOverload?: OverloadState };

// Next's static files, the public pictures (logo, favicons, assistant/*.webp), sign-in, cron jobs, the website API.
const EXEMPT = /^\/(?:_next\/|api\/auth\/|api\/cron\/|api\/site\/v1\/|(?:assistant\/)?[^/?]+\.(?:png|ico|webp|svg)(?:\?|$))/;

// Pure decision, for tests.
export function shouldShed(method: string | undefined, url: string | undefined, s: { inflight: number; avgMs: number }, limits: { targetMs: number; min: number; max: number } = defaultLimits()): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (EXEMPT.test(url || '/')) return false;
  if (s.inflight >= limits.max) return true;
  return s.avgMs > limits.targetMs && s.inflight > limits.min;
}

export function defaultLimits() {
  return {
    targetMs: num(process.env.OVERLOAD_TARGET_MS, 10000),
    min: num(process.env.OVERLOAD_MIN_INFLIGHT, 64),
    max: num(process.env.OVERLOAD_MAX_INFLIGHT, 1500),
    holdMs: process.env.OVERLOAD_HOLD_MS !== undefined && Number(process.env.OVERLOAD_HOLD_MS) >= 0 ? Number(process.env.OVERLOAD_HOLD_MS) : 1000,
  };
}

export function overloadState(): OverloadState | null {
  return g.__seoOverload || null;
}

// Also keeps the change counter of lib/sharedRead.ts, which must run even with the guard off.
export function installOverloadGuard() {
  if (g.__seoOverload) return;
  const guard = process.env.OVERLOAD_GUARD !== 'off';
  const state: OverloadState = (g.__seoOverload = { inflight: 0, avgMs: 0, shed: 0 });
  const limits = defaultLimits();
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if (event !== 'request') return emit.call(this, event, ...args);
    const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
    noteRequest(req, res);
    if (guard && shouldShed(req.method, req.url, state, limits)) {
      state.shed++;
      const api = (req.url || '').startsWith('/api/');
      const refuse = () => {
        if (res.destroyed) return;
        res.writeHead(503, { 'Content-Type': api ? 'application/json' : 'text/plain; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' });
        res.end(api ? JSON.stringify({ error: 'The dashboard is very busy right now. Try again in a few seconds.' }) : 'The dashboard is very busy right now. Reload in a few seconds.');
      };
      if (limits.holdMs) setTimeout(refuse, limits.holdMs).unref();
      else refuse();
      return true;
    }
    state.inflight++;
    const t0 = Date.now();
    res.once('close', () => {
      state.inflight--;
      // Average over about the last 20 answers.
      state.avgMs += (Date.now() - t0 - state.avgMs) / 20;
    });
    return emit.call(this, event, ...args);
  } as typeof emit;
}

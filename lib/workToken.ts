// The Windows activity watcher runs outside the browser session, so it authenticates its activity
// reports with a per-person work token in a header (not a sign-in cookie). The token opens only the
// one report endpoint; the route then resolves which person it belongs to (lib/worklog.ts).
import type { NextRequest } from 'next/server';

export const WORK_TOKEN_HEADER = 'x-work-token';
export const getWorkToken = (req: NextRequest) => req.headers.get(WORK_TOKEN_HEADER) || '';
export const hasWorkToken = (req: NextRequest) => Boolean(req.headers.get(WORK_TOKEN_HEADER));
export const workTokenAllows = (method: string, path: string) =>
  (method.toUpperCase() === 'POST' && /^\/api\/worklog\/report\/?$/.test(path)) ||
  // The device also reads the lock gate (is this person's training done for today?) to lock or free
  // the laptop. Read-only, token-identified, same as the report endpoint.
  (method.toUpperCase() === 'GET' && /^\/api\/worklog\/gate\/?$/.test(path));

// Blog edits from Claude Code (scripts/draft.ts), without the dashboard's AI and its API credits.
//
// A request carrying `Authorization: Bearer <DRAFT_EDIT_TOKEN>` may only read drafts and change a
// draft's title, meta description and article, read the AI credit spend, and answer the Testing mode
// AI queue (scripts/agent.ts): never approve, reject, publish, delete or touch anything else. Unset (or shorter than 24 characters) = switched off.

const ALLOWED: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/drafts\/list$/ },
  { method: 'GET', path: /^\/api\/drafts\/\d+$/ },
  { method: 'PATCH', path: /^\/api\/drafts\/\d+$/ },
  { method: 'GET', path: /^\/api\/drafts\/\d+\/download$/ },
  // Read-only: AI credit spend, so Claude Code can report what costs what (cannot change anything).
  { method: 'GET', path: /^\/api\/ai-credits$/ },
  // Testing mode: read the waiting AI jobs and send Claude Code's answers (lib/aiQueue.ts).
  { method: 'GET', path: /^\/api\/agent$/ },
  { method: 'POST', path: /^\/api\/agent$/ },
];

export const DRAFT_TOKEN_ACTOR = 'Claude Code (edit token)';

export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasDraftToken(req: Request): boolean {
  const token = process.env.DRAFT_EDIT_TOKEN || '';
  if (token.length < 24) return false;
  return sameText(req.headers.get('authorization') || '', `Bearer ${token}`);
}

export function draftTokenAllows(method: string, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  return ALLOWED.some((a) => a.method === method.toUpperCase() && a.path.test(p));
}

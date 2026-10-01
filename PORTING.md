# Porting conventions (old app -> this app)

Old app (read-only reference): `../seo-blog-automation/`
New app: this folder. Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui (base-nova style, Base UI primitives — components use a `render` prop, not `asChild`), Prisma 7 + Neon, next-auth v4.

## HARD RULE: no functionality changes
Every tab, button, field, message, status, API path, HTTP method, request body, response JSON shape, status code,
streaming format, prompt text, validation rule, default and ordering must behave exactly as in the old app.
Port logic 1:1. Do not "improve", rename, reorder, drop, or add features. Keep comments that explain behaviour.
If something truly cannot be kept identical (only the platform differences listed below), keep the observable behaviour
the same and leave a `// PORT NOTE:` comment.

## Files
- `lib/foo.js` -> `lib/foo.ts` (same exported names). `lib/assistant/*.js` -> `lib/assistant/*.ts`.
- `pages/api/x/y.js` -> `app/api/x/y/route.ts`; `pages/api/x/index.js` -> `app/api/x/route.ts`;
  `pages/api/x/[id].js` -> `app/api/x/[id]/route.ts`; `[...file]` stays a catch-all.
- Use ES module `import`/`export`, `@/lib/...` alias. Types can be loose (`any` is fine; noImplicitAny is off) — correctness over typing.

## Database (was lib/db.js, node:sqlite, sync)
- `import prisma from '@/lib/prisma'`. Models and fields are named EXACTLY like the old tables/columns (snake_case):
  `prisma.drafts.findUnique({ where: { id } })` returns `row.content_html`, `row.created_at` etc. Schema: `prisma/schema.prisma`.
- JSON columns are still TEXT strings -> keep the old `JSON.parse` / `JSON.stringify` exactly.
- Timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' UTC. Use `lib/time.ts`:
  `datetime('now')` -> `sqlNow()`, `datetime('now', ?)` / `datetime('now','-90 days')` -> `sqlNowOffset(mod)`, `date('now')` -> `sqlToday()`.
  DB defaults fill created_at on insert, but any explicit `updated_at = datetime('now')` must be set to `sqlNow()`.
- `.get()` -> `findFirst/findUnique` (null instead of undefined — check callers that compare `=== undefined`),
  `.all()` -> `findMany` (preserve ORDER BY, LIMIT, WHERE exactly; SQLite `ORDER BY id DESC` -> `orderBy: { id: 'desc' }`),
  `.run()` INSERT -> `create` (`info.lastInsertRowid` -> `created.id`), UPDATE/DELETE -> `update/updateMany/deleteMany`
  (`info.changes` -> `result.count`).
- SQLite `LIKE` is case-insensitive for ASCII -> Prisma `contains` with `mode: 'insensitive'`.
- `ON CONFLICT ... DO UPDATE` -> `upsert`. `db.transaction(fn)` -> `prisma.$transaction(async (tx) => ...)`.
- Complex aggregate SQL may use `prisma.$queryRaw` (tagged template, Postgres syntax) if a Prisma query can't express it — keep results identical (note Postgres returns COUNT as BigInt: convert with Number()).
- DB access is now ASYNC. Any function that touches the DB (directly or via settings/activity/questionBank/etc.) becomes `async`
  and every caller must `await` it. In route handlers, ALWAYS `await` calls into lib (awaiting a non-promise is harmless).
- Old startup resets in lib/db.js (stuck 'generating' keywords / 'running' conversations) are replaced by `app/api/cron/sweep/route.ts` — don't port them.

## Shared helpers already written (use them)
- `lib/prisma.ts`, `lib/time.ts` (sqlNow, sqlNowOffset, sqlToday)
- `lib/storage.ts` — replaces the local `uploads/` folder (Vercel Blob, private): `saveFile(key, buffer, contentType?)`,
  `readFile(stored)` -> Buffer|null, `fileExists(stored)`, `deleteFile(stored)`, `toKey(stored)`, `mimeFor(key)`, `basename(stored)`.
  Keys are paths relative to the old uploads/ dir: featured image `"<name>.jpg"`, assistant `"assistant/<ts>-<name>.png"`.
  DB columns (`drafts.featured_image_path`, `image_library.path`, `image_library.model_path`) now store that KEY
  (legacy absolute paths are also accepted by toKey). Replace `fs.readFileSync(p)` with `await readFile(p)`,
  `fs.existsSync(p)` with `await fileExists(p)`, writes with `await saveFile(key, buf)`.
- `lib/tokenStore.ts` — replaces `secrets/<provider>-tokens.json`: `readTokens(provider)`, `writeTokens(provider, obj)`,
  `hasTokens(provider)`; provider is `'zoho'` or `'gbp'`. (hasStoredTokens becomes async.)
- `lib/auth.ts` — `getActor()` returns the signed-in user's name. Replace every hardcoded `actor: 'Abhuday'` with
  `actor: await getActor()` (in route handlers). Keep `'system'` where the old code used system/no actor.
- Google service account: keep lib/searchConsole's existing `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` support (Vercel uses that).

## Route handlers (was pages/api)
- `export const runtime = 'nodejs';` in every route. Old `config.maxDuration = N` -> `export const maxDuration = N;`
  EXCEPT these long streaming ones use `export const maxDuration = 800;`: generate, strategy (index POST), assistant/chat, assistant/decide.
  Drop old `bodyParser` config (App Router reads bodies itself; for the old 2mb assistant limit nothing is needed).
- One exported function per method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`). Old `if (req.method !== 'X') return res.status(405)...`:
  export only the supported methods (Next returns 405 for the rest) — but if the old handler returned a specific JSON body for
  405, add the other methods returning that same body/status.
- `req.query.x` -> for dynamic segments `const { id } = await params` (params is a Promise in Next 16: `{ params }: { params: Promise<{ id: string }> }`);
  for query string `req.nextUrl.searchParams.get('x')` (use `NextRequest`). Values are strings as before.
- `req.body` (JSON) -> `await req.json().catch(() => ({}))`. `res.status(s).json(o)` -> `NextResponse.json(o, { status: s })`.
  `res.status(s).end(text)` -> `new Response(text, { status: s })`. `res.redirect(url)` -> `NextResponse.redirect(new URL(url, req.url))`.
  Binary downloads (.docx): `new Response(buffer, { headers: { 'Content-Type': ..., 'Content-Disposition': ... } })` with the same headers.
- Uploads (formidable) -> `const form = await req.formData(); const file = form.get('<same field name>') as File;`
  `Buffer.from(await file.arrayBuffer())`, `file.name`, `file.type`, `file.size`. Keep the same field names, size/type checks, error messages.
  Non-file fields: `form.get('x')`.
- Streaming (NDJSON / SSE): build a `ReadableStream`, write the exact same lines (`JSON.stringify(evt) + '\n'`) and same
  Content-Type/headers. Client disconnect: old `req.on('close')` / `res.on('close')` -> `req.signal.addEventListener('abort', ...)`,
  preserving whatever the old code did (abort controller, reset keyword to pending, etc.).
- OAuth callback routes that returned HTML: return `new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })`
  (escape interpolated error text with a small escapeHtml — same visible message).

## UI (was pages/index.js + components/*.js + styles/globals.css)
- Client components (`'use client'`) in `components/tabs/<name>-tab.tsx` with a default export and the props the shell passes
  (see `components/dashboard.tsx`): `AssistantTab({ seed })`, `StrategyTab({ active })`, `PerformanceTab({ view, onOpen })`, others no props.
- Same fetch calls to the same `/api/...` URLs, same request bodies, same handling of responses, same polling intervals,
  same confirm() prompts and alerts (you may show them with shadcn AlertDialog / sonner `toast` but the text and the
  decision flow must be the same), same conditional rendering, same labels and copy text.
- Restyle with Tailwind + shadcn components from `components/ui/*` (Card, Button, Badge, Table, Input, Textarea, Select,
  Checkbox, Switch, Tabs, Dialog, AlertDialog, Tooltip, Progress, Skeleton, Alert, ScrollArea, Collapsible, RadioGroup, Sheet, Popover, chart).
  Clean modern dashboard look, responsive, works in light AND dark mode (use theme tokens like `bg-card`, `text-muted-foreground`,
  `border`, `bg-muted` — never hardcoded hex colours except for data-driven chart colours). Do not use the old globals.css classes.
  Status badges: map old `badge <status>` colours to Badge variants/Tailwind classes consistently.
- Rendered article HTML: wrap in `className="prose-article"` (defined in app/globals.css).
- Shared UI helpers live in `components/shared/`:
  `components/shared/article.tsx` exports `sanitizeArticleHtml`, `SafeHtml`, `renderMarkdown`, `isSafeUrl` (ported 1:1 from
  pages/index.js L110-277) — owned by the agent porting the Assistant/Keywords/Drafts tabs; others import from it.
  `components/shared/blog-insights.tsx` exports `KeywordPanel`, `BlogAnalytics`, `BlogTable` (from components/BlogInsights.js) — same owner.
  `components/shared/ui-bits.tsx` exports small shared widgets used across many tabs (e.g. ActionMessage, SimpleTable, Delta, status badge helper) —
  owned by the agent porting Audit/Renewal/Performance/Strategy.
- Image URLs: keep `/api/uploads/<...>` exactly as the old UI built them.

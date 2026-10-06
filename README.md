# USAIndiaCFO Growth Center

Internal SEO and content automation dashboard: keywords → Claude research and draft → human review → WordPress,
plus blog audits and renewal, SEO/AEO/GEO reports, monthly strategy, training, meetings insights and a site assistant.

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui
- Prisma 7 + Neon Postgres · Vercel Blob (uploads) · NextAuth (Google, @usaindiacfo.com only)
- Hosted on Vercel (Fluid compute; long generation routes use `maxDuration = 800`, which needs the Pro plan)

## Local setup
1. Node 22.5+ (`node -v`).
2. `npm install`
3. `cp .env.example .env` and fill it in (Neon `DATABASE_URL`, Google OAuth client, `NEXTAUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, API keys).
4. `npx prisma migrate deploy` - creates the tables.
5. Optional, once: copy the old app's data - `OLD_APP_DIR=../seo-blog-automation npm run migrate:sqlite`
6. `npm run dev` → http://localhost:3000

## Deploying to Vercel
1. Import the repo in Vercel; add the Neon integration (sets `DATABASE_URL`) and a **private** Blob store (sets `BLOB_READ_WRITE_TOKEN`).
2. Add every variable from `.env.example`. Set `NEXTAUTH_URL` to the production URL.
3. In Google Cloud, add `<NEXTAUTH_URL>/api/auth/callback/google` to the OAuth client's redirect URIs.
   Update the Zoho and GBP OAuth apps' redirect URIs to `<NEXTAUTH_URL>/api/zoho/oauth-callback` and `/api/gbp/oauth-callback`.
4. Deploy. `npm run build` runs `prisma generate` and `prisma migrate deploy` automatically.

## Scheduled jobs (self-hosted on Coolify)
Coolify does not read `vercel.json` (kept only for a Vercel deploy). Add each job in Coolify:
application > **Scheduled Tasks** > Add, container = the app, with this command (swap the path):

```
node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/cron/daily',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>r.text()).then(console.log)"
```

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/daily` | `*/15 * * * *` (every 15 min) | Blog drafts, 24-hour review window, auto-approve and publish, Facts Register gate; rank check once a day |
| `/api/cron/weekly` | `0 5 * * 1` (Mondays) | Plan vs actual check |
| `/api/strategy/auto-check` | `30 3 1 * *` (1st of month) | Generates next month's strategy |
| `/api/skill/auto-check` | `0 3 * * *` | Refreshes the writing skill when it is 15+ days old |
| `/api/cron/sweep` | `*/15 * * * *` | Frees keywords/assistant runs left stuck by a killed process |

`CRON_SECRET` must be set in the app's environment. Uploads (Screaming Frog files, images) are
stored under `UPLOADS_DIR`; mount it as a persistent volume so they survive redeploys.

Cron requests are authorised with `CRON_SECRET`; everything else requires a signed-in Google account.

## Project layout
- `app/` - pages (`page.tsx` dashboard, `login/`) and API route handlers (`app/api/**/route.ts`)
- `components/tabs/` - one file per dashboard tab; `components/shared/` - shared widgets; `components/ui/` - shadcn
- `lib/` - domain logic (Claude pipeline, validation, WordPress, Google, Zoho, strategy, assistant)
- `prisma/` - schema and migrations · `scripts/migrate-sqlite.ts` - one-off import from the old SQLite app
- `skills/seo-blog-playbook/SKILL.md` - writing playbook injected into prompts
- `wordpress/yoast-rest-fields.php` - snippet the WordPress site needs so Yoast meta can be set via REST

## Monthly Strategy (SEO, AEO, GEO)

One strategy per month, one approval, then the month runs automatically.

- **Generate:** `/api/strategy/auto-check` runs at 03:30 UTC on the 1st and builds next month's
  strategy (Claude at maximum effort with web research; every number filled in code from SE
  Ranking, Search Console, GA4, SERPHouse, Zoho and the month-end report, else `DATA MISSING`).
- **Approve gate:** a Screaming Frog export (CSV/XLSX) uploaded in the last 7 days plus zero
  validation errors (tags on every item, growth targets, 40% priority for a falling channel, intent
  mix, focus services, no repeated keywords, safe backlink methods).
- **Every 15 minutes** (`/api/cron/daily`): drafts blogs 48h ahead, opens the 24-hour
  review window, publishes reviewed or auto-approved blogs behind the Facts Register and writing
  rule gates, then IndexNow, sitemap resubmit, SE Ranking tracking and internal links; once a day,
  a rank check with a 5+ position drop alert.
- **Weekly** (`/api/cron/weekly`, Mondays): plan vs actual.
- **AI visibility (GEO and AEO):** pulled from SE Ranking with the existing `SERANKING_API_KEY`: AI Search
  (link presence and position in ChatGPT, Perplexity, Gemini, AI Overviews and AI Mode, US and India) and
  the AI Results Tracker (brand mentions in the project's tracked prompts). Live view: `/api/seranking/ai-visibility`.
- Settings keys: `focus_services` (one per line or `;`), `competitor_domains`, `posting_days`
  (default `Tue,Thu`), `posting_time_ist` (default `10:00`).
- Tests: `npm test` (rules) and `DATABASE_URL=... npm run test:e2e` (real Postgres, stubbed APIs).

New environment variables: `INDEXNOW_KEY` (and the key file at `https://<site>/<key>.txt`, or
`INDEXNOW_KEY_LOCATION`), `REVIEW_NOTIFY_EMAILS` + `RESEND_API_KEY` (+ optional
`NOTIFY_FROM_EMAIL`) and/or `SLACK_WEBHOOK_URL`, optional `SITEMAP_URL`, `STRATEGY_MODEL`,
`FACT_CHECK_MODEL`, `STRATEGY_MAX_SEARCHES`, `WRITER_MAX_SEARCHES`.

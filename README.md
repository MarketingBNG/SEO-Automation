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

## Scheduled jobs (`vercel.json`)
| Path | Schedule | What it does |
|---|---|---|
| `/api/skill/auto-check` | daily 03:00 UTC | Refreshes the writing skill when it is 15+ days old |
| `/api/strategy/auto-check` | daily 03:30 UTC | Generates the monthly strategy when due |
| `/api/cron/sweep` | every 15 min | Frees keywords/assistant runs left stuck by a killed function |

Cron requests are authorised with `CRON_SECRET`; everything else requires a signed-in Google account.

## Project layout
- `app/` - pages (`page.tsx` dashboard, `login/`) and API route handlers (`app/api/**/route.ts`)
- `components/tabs/` - one file per dashboard tab; `components/shared/` - shared widgets; `components/ui/` - shadcn
- `lib/` - domain logic (Claude pipeline, validation, WordPress, Google, Zoho, strategy, assistant)
- `prisma/` - schema and migrations · `scripts/migrate-sqlite.ts` - one-off import from the old SQLite app
- `skills/seo-blog-playbook/SKILL.md` - writing playbook injected into prompts
- `wordpress/yoast-rest-fields.php` - snippet the WordPress site needs so Yoast meta can be set via REST

# Repo map (SEO-Automation / "Growth Center")

Next.js app (App Router, `proxy.ts` instead of middleware), Prisma on Postgres, self-hosted on Coolify
(Vercel crons still declared in `vercel.json`). Snapshot of 2026-10-28. No secrets here: env vars by name only.

## 1. Pages and dashboard tabs

| Page | File | Who |
|---|---|---|
| `/` dashboard shell | `app/page.tsx` -> `components/dashboard.tsx` | any signed-in team member |
| `/login` | `app/login/page.tsx` (Google sign-in, `@usaindiacfo.com`) | public |

Tabs (`TABS` in `components/dashboard.tsx`, `?tab=<key>`). Visibility comes from the session token's
`access.pages` (role default from `lib/permissions.ts` `HIDDEN_PAGES`, admin-editable per role in
settings `role_access`, plus per-person `access_grants`). The dashboard's own `HIDDEN` list is only used
before the role loads and differs for manager/analyst (it does not hide `settings`).

| Key | Label | Group | Component | Hidden by default for |
|---|---|---|---|---|
| home | Home | Start | tabs/home-tab | - |
| assistant | Assistant | Start | tabs/assistant-tab (kept mounted) | - |
| guide | Guide & map | Start | tabs/guide-tab | - |
| strategy | Monthly Strategy | Plan | tabs/strategy-tab | - |
| calendar | Blog Calendar | Plan | strategy-tab `MonthRunning` | - |
| topics | Topics & News | Plan | tabs/topics-tab | user |
| keywords | Write a blog | Write | tabs/keywords-tab | user |
| drafts | Drafts & Review | Write | tabs/drafts-tab | user |
| audit | Check a blog | Write | tabs/audit-tab | user |
| renewal | Refresh a live blog | Write | tabs/renewal-tab | user |
| training | Writing rules | Write | tabs/training-tab | user |
| sitecontent | Website Content | Website | tabs/website-content-tab | user |
| overall / seo / aeo / geo | Reports | Reports | tabs/performance-tab (view prop) | user |
| meetings | Meeting insights | Reports | tabs/meetings-tab | user |
| associates | Associate Training | Team | tabs/associate-training-tab | - |
| team | Team & Roles | Team | tabs/team-tab | analyst, tester, user |
| activity | Activity Log | Team | tabs/activity-tab | user |
| settings | Settings | Admin | tabs/settings-tab | manager, analyst, user |

Header on every tab: assistant prompt, Refresh, `StatusLight` (`/api/status`), `JobProgress` (`/api/progress`),
link to the Social dashboard (`/api/links`).

## 2. API routes

### Auth layers
- `proxy.ts` (every path except `_next/static|image`, favicon, non-API images):
  1. Public: `/api/auth/*`, `/login`, `/api/site/v1/*` (these check `SITE_API_KEY` / `SITE_IMPORT_KEY` themselves).
  2. `Authorization: Bearer DRAFT_EDIT_TOKEN` (>= 24 chars): only the allow-list in `lib/draftToken.ts`
     (GET `/api/drafts/list`, GET/PATCH `/api/drafts/<id>`, GET `/api/drafts/<id>/download`,
     GET `/api/ai-credits`, GET/POST `/api/agent`); anything else 403.
  3. `Authorization: Bearer CRON_SECRET`: only GET on `/api/cron/*`, `/api/skill/auto-check` and
     `/api/strategy/auto-check` (`cronAllows` in `lib/cronSecret.ts`); anything else 403.
  4. NextAuth JWT: role, block and access are read live from the database (`liveAccessFor` in
     `lib/access.ts`, cached 30 s; the token's copy only when the database is down). Blocked users get 403
     on any non-GET API call and on a GET that maps to settings.change; `actionFor(method, path)`
     (`lib/permissions.ts`) names the action; non-admins need it in their access or grants. No token:
     401 for `/api/*`, redirect to `/login` for pages.
- `actionFor` defaults: GET/HEAD -> `reports.download` (performance/download, audit/<id>/download),
  `reports.view` (performance, ga4, gsc, seranking, clarity, blog-analytics, zoho/leads|pipeline|business),
  `credits.view` (ai-credits, agent), `team.view` (team), `reports.view` (client-insights), `settings.change`
  (gbp|zoho auth-url and oauth-callback, fireflies/transcripts, serphouse/check, pagespeed/check), else
  **none (any signed-in member)**.
  Writes -> settings.change (seranking/topup, settings, gsc, ga4, gbp, zoho, wordpress, fireflies, bing,
  surfer/test, serphouse/test, seranking/test), assistant.ask (assistant/chat|upload), website.change
  (assistant/decide|undo), manual.do (associate-training, strategy/manual, strategy/backlinks/*,
  strategy/schedule/<id>), strategy.approve (strategy/<id>/approve), strategy.edit (other strategy),
  credits.change (ai-credits, agent), team.roles (team/access), team.view (team), else **content.work**.
- Route-level checks: `getMe()` (`lib/auth.ts`, session), `canDo()` (`lib/access.ts`), `isCronRequest()`
  (`app/api/_lib/http.ts`, CRON_SECRET).
- "any" = legacy handler exported for GET/POST/PUT/PATCH/DELETE (the write methods then fall under the write rule).

### Routes (path under `app/api/`; guard = proxy action unless noted)
| Route | Methods | What | Guard |
|---|---|---|---|
| auth/[...nextauth] | GET,POST | NextAuth Google sign-in | public |
| activity/list | GET | activity_log with filters | signed-in; non-admin sees own rows (+automatic) |
| agent | GET,POST | Testing-mode AI queue (ai_jobs) list / answer | credits.view / credits.change, or draft token |
| ai-credits | GET,POST | spend, balance, pause/resume, key test, Testing/Live mode | credits.view / credits.change; mode switch admin only (getMe) |
| assistant/chat | POST | streamed assistant turn (lib/assistant/engine) | assistant.ask |
| assistant/conversations | GET | conversation history | signed-in; owner or admin (getMe) |
| assistant/decide | POST | approve/deny pending write tools | website.change |
| assistant/files | GET | all chat attachments | signed-in |
| assistant/undo | POST | undo a site_changes row | website.change |
| assistant/upload | POST | save chat attachment (image / docx) | assistant.ask |
| associate-training | GET,POST | lessons, tests, profiles | manual.do; admin/manager actions checked in route |
| audit | GET,POST | list / start audits | GET signed-in (admin/tester get source info); POST content.work |
| audit/[id]/download | GET | rewrite as .docx | reports.download |
| audit/[id]/publish | POST | publish rewrite to WP (replace or new) | content.work |
| audit/[id]/rewrite | POST | start rewrite job | content.work |
| audit/extract | POST | .docx -> HTML (mammoth) | content.work |
| audit/stop | POST | stop audit/rewrite | content.work |
| bing/test | GET,POST | Bing Webmaster connection test | GET signed-in; POST settings.change |
| blog-analytics | GET | one blog / all blogs analytics | reports.view |
| clarity/insights | any | Clarity live insights | GET reports.view |
| client-insights | GET,POST,PUT | meeting insights; PUT pulls Fireflies now | GET reports.view; writes content.work |
| client-insights/[id] | PATCH,DELETE | edit/delete insight | content.work |
| cron/daily | GET | `runDaily()` via `runAutomatic` | CRON_SECRET only (`isCronRequest`, else 403) |
| cron/weekly | GET | `runWeekly()` via `runAutomatic` | CRON_SECRET only (`isCronRequest`, else 403) |
| cron/sweep | GET | reset stuck keywords/conversations/strategies | CRON_SECRET only (`isCronRequest`, else 403) |
| drafts/list | GET | drafts list (admin/tester also get schedule) | signed-in or draft token |
| drafts/[id] | GET,PATCH,DELETE | read / edit / delete draft | GET signed-in; writes content.work; draft token GET/PATCH |
| drafts/[id]/cover | GET,POST | cover image (uploaded or generated) | GET signed-in; POST content.work |
| drafts/[id]/download | GET | Word file | signed-in or draft token |
| drafts/[id]/image | POST | replace featured image | content.work |
| drafts/[id]/images | GET,POST | inline images | content.work |
| drafts/[id]/keywords | GET,POST | keyword usage check | content.work |
| drafts/[id]/originality | POST | plagiarism check | content.work |
| drafts/[id]/publish | POST | publish to WordPress / site connector | content.work (+blog.publish_now in schedule route) |
| drafts/[id]/recheck | POST | re-run open fact-check issues | content.work |
| drafts/[id]/word | POST | parse uploaded .docx back into a blog | content.work |
| facts/[id] | PATCH | review a fact | content.work |
| fireflies/test, fireflies/transcripts | any | connection test / transcripts | GET test signed-in, transcripts settings.change; writes settings.change |
| ga4/summary, ga4/top-pages | any | GA4 data | GET reports.view |
| gbp/auth-url, gbp/oauth-callback, gbp/test | any | Business Profile OAuth + test | GET auth-url/oauth-callback settings.change, test signed-in; writes settings.change |
| generate | POST | write next blog (streamed NDJSON) | content.work |
| generate/stop | POST | stop blog generation(s) | content.work |
| gsc/test, gsc/top-queries | any | Search Console | GET reports.view |
| home | GET | Home tab summary (DB only) | signed-in |
| keywords/add, keywords/upload | POST | add keywords (duplicate check) | content.work |
| keywords/list | GET | last 500 keywords | signed-in |
| keywords/[id]/retry | POST | requeue failed keyword | content.work |
| lessons | GET,POST | weekly lessons; POST runs now | GET signed-in; POST content.work |
| links | GET | Social dashboard link | signed-in |
| pagespeed/check | any | PageSpeed Insights for a URL | settings.change |
| performance | GET | SEO/AEO/GEO report | reports.view |
| performance/download | GET | report .docx | reports.download |
| performance/explain | GET | AI "why it changed" paragraph (Claude) | reports.view |
| progress | GET | running jobs for header bar | signed-in |
| seranking/ai-visibility | GET | live AI visibility (spends SE Ranking credits) | reports.view |
| seranking/rankings, seranking/research, seranking/test | any | SE Ranking data | GET reports.view |
| seranking/topup | GET,POST | tracked-keyword top-up status / start | GET reports.view; POST settings.change |
| serphouse/check | GET | live SERP lookup (paid, 12h cache) | settings.change |
| serphouse/test | GET | connection test | signed-in |
| settings | GET,POST | all settings / set keys | GET signed-in; POST settings.change |
| site-content | GET,POST | custom-site pages/posts; POST saves + webhooks site | GET signed-in; POST content.work |
| site/v1/pages, pages/[...slug], posts, posts/[...slug], redirects | GET | public website read API | `SITE_API_KEY` in route |
| site/v1/import | POST | bulk import pages/posts/redirects | `SITE_IMPORT_KEY` in route |
| skill | GET,POST | writing skill read / manual edit | GET signed-in; POST content.work |
| skill/auto-check | GET,POST | refresh skill if >= 15 days old (Batch API) | GET only with CRON_SECRET; POST content.work |
| skill/generate | POST | regenerate writing skill now | content.work |
| skill/playbook | GET | playbook text | signed-in |
| skill/status | any | skill age/status | GET signed-in |
| status | GET | scheduler status light | signed-in |
| strategy | GET,POST | list / start strategy job | GET signed-in; POST strategy.edit |
| strategy/[id] | GET,PATCH | full strategy / edit section | GET signed-in; PATCH strategy.edit |
| strategy/[id]/approve | POST | approve month | strategy.approve |
| strategy/[id]/changes | POST | mid-month change | strategy.edit |
| strategy/[id]/control | POST | pause/resume/stop generation | strategy.edit |
| strategy/[id]/manual | GET | manual tasks (users: only theirs) | signed-in, getMe |
| strategy/[id]/progress | GET | progress + cost estimate | signed-in |
| strategy/[id]/refresh | POST | cheap update without rebuild | strategy.edit |
| strategy/auto-check | GET | start strategy if none covers 3 days | report only; starts job only with CRON_SECRET |
| strategy/backlinks/[id] | PATCH | tick backlink task | manual.do (+getMe user check) |
| strategy/crawl | GET,POST | Screaming Frog upload, rebuild section 8 | GET signed-in; POST strategy.edit |
| strategy/manual | POST | guide/done/undo/assign manual task | manual.do; assign needs `canDo(manual.assign)`; users only own tasks |
| strategy/schedule | GET | blog calendar | signed-in |
| strategy/schedule/[id] | GET,PATCH | approve/reject/pause/reschedule calendar blog | manual.do; publish-now needs `canDo(blog.publish_now)` |
| surfer/terms | POST | Surfer content editor terms (1 credit) | content.work |
| surfer/test | GET | list workspaces | signed-in |
| team | GET,POST | team list / add, role, block | team.view; roles via `canDo(team.roles)`, block via `canBlock` |
| team/access | GET,POST | role access + grants | team.view / team.roles (admin) |
| technical | GET | crawls | signed-in |
| technical/import | POST | Screaming Frog import | content.work |
| topics | GET,POST | today's topics / research now | GET signed-in; POST content.work |
| topics/[id] | POST | blog / article / relevance / manual upload | content.work |
| training/digest | GET,POST | research digests; POST generates (Claude) | GET signed-in; POST content.work |
| training/digest/[id] | PATCH | approve/reject digest | content.work |
| training/examples | GET,POST | style examples | GET signed-in; POST content.work |
| training/examples/[id] | DELETE | delete example | content.work |
| uploads/[...file] | GET | serve stored file (lib/storage) | signed-in |
| wordpress/download | GET | live post as .docx | signed-in |
| wordpress/posts | any | WP post list with audit/draft origin | GET signed-in; writes settings.change |
| wordpress/test | any | WP connection test | GET signed-in |
| wordpress/yoast-status | GET | Yoast REST snippet check | signed-in |
| zoho/auth-url, zoho/oauth-callback, zoho/test | any | Zoho OAuth + test | GET auth-url/oauth-callback settings.change, test signed-in; writes settings.change |
| zoho/leads, zoho/pipeline | any | CRM data | GET reports.view |
| zoho/business | GET | leads/consults/clients by blog topic | reports.view |

## 3. lib modules

- `access.ts` role access (settings `role_access`) + `access_grants`; `canDo()`.
- `activity.ts` writes `activity_log` (actor from session, else automatic). `activityAreas.ts` action -> area/label.
- `agentMemory.ts` writer / fact-checker memories (`agent_memories`), weekly tidy.
- `aiCredits.ts` cost per call (`ai_usage`), price table, balance, auto pause/resume, Anthropic cost report.
- `aiQueue.ts` Live vs Testing mode; Testing queues requests in `ai_jobs`; `runAutomatic` blocks automatic work.
- `aiReplay.ts` saves finished AI steps (`ai_replay`) so restarted runs do not pay twice; resumes credit-paused blog.
- `aiVisibility.ts` SE Ranking AI Search / AI results for GEO/AEO.
- `anthropic.ts` core Claude calls: writer, repair, fact check (two models), skill generation, digest, Batch API, web search.
- `anthropicClient.ts` single Anthropic client with secondary-key fallback; key check.
- `apiCache.ts` cache of paid API answers in settings. `apiErrors.ts` friendly Anthropic errors.
- `articleWriter.ts` LinkedIn article draft (kind "article").
- `associateTraining.ts` daily lessons/tests for associates (09:00 IST).
- `auditJobs.ts` audits/rewrites as background jobs. `audits.ts` runs one audit (text, URL, WP post).
- `auth.ts` NextAuth options (Google, domain + team check, token carries role/access), `getMe`, `getActor`.
- `authors.ts` byline authors list and WP user ids. `byline.ts` byline + expert schema in posts.
- `bing.ts` Bing Webmaster URL submit/test. `clarity.ts` Clarity export API.
- `blogAnalytics.ts` per-blog GSC/GA4 analytics. `blogDoc.ts` blog -> Word. `docx.ts` html-to-docx wrapper.
- `blogImages.ts` inline image notes/placement. `inlineMedia.ts` uploads inline images at publish.
- `blogJob.ts` one blog end to end (research, write, checks, save); restart of interrupted blogs.
- `blogKeywords.ts` keyword plan/usage for a blog. `keywordPlanner.ts` choose/check keyword plan.
- `blogRuns.ts` in-process map of running blog generations (Stop button).
- `clientInsights.ts` Fireflies meeting -> cleaned insights (Claude). `fireflies.ts` Fireflies GraphQL.
- `competitors.ts` competitor domains from SERP analysis.
- `cover.ts` branded 1200x630 cover (no API). `coverPhoto.ts` photo cover: Pexels, else OpenAI image; Claude art direction.
- `draftToken.ts` Claude Code edit-token allow-list. `factCheckMark.ts` marks edited text as checked.
- `duplicates.ts` blocks repeated topics. `ga4.ts` GA4 Data API. `gbp.ts`/`gbpAuth.ts` Business Profile + OAuth.
- `indexing.ts` IndexNow + GSC sitemap resubmit. `jobTimer.ts` live step timers/estimates.
- `keywordTracking.ts` keeps SE Ranking tracked keywords aligned with strategy (weekly top-up).
- `leadAttribution.ts` Zoho leads by blog/service. `lessons.ts` weekly self-learning into `writer_lessons`.
- `monthlyMetrics.ts` month-over-month numbers. `notify.ts` Slack webhook + activity log.
- `originality.ts` plagiarism check (Google top pages, own blogs, Copyscape optional).
- `pagespeed.ts` PSI. `performanceReport.ts` SEO/AEO/GEO report (no AI). `performanceExplain.ts` Claude explanation.
- `performanceDoc.ts` report -> Word with charts. `permissions.ts` roles, actions, pages, `actionFor`.
- `playbook.ts` reads `skills/seo-blog-playbook/SKILL.md` sections. `prisma.ts` Prisma client.
- `questionBank.ts` PAA questions (`paa_questions`, raw upsert). `researchBrief.ts` pre-writing brief from all tools.
- `reviewers.ts` stub (CA/CPA step removed). `scheduler.ts` built-in 15-minute scheduler.
- `searchConsole.ts` Google service-account auth + GSC queries. `seoCalendar.ts` fixed compliance/Google-update dates.
- `seoStrategy.ts` snapshot from connected tools. `strategyAnalysis.ts` strategy analysis computed in code.
- `seranking.ts` SE Ranking API with 1 req/s queue. `serphouse.ts` live SERP. `surfer.ts` Surfer API.
- `settings.ts` key/value settings with defaults. `siteChecks.ts` daily live-site checks.
- `siteConnector.ts` new custom website connector (replaces WP when configured). `siteContent.ts` custom-site content + signed webhook.
- `smartlead.ts` Smartlead client. `socialSkills.ts` design skills / banners from the Social dashboard.
- `storage.ts` Vercel Blob or local `UPLOADS_DIR`. `technicalAudit.ts` Screaming Frog parser.
- `team.ts` team members, owner, tester expiry. `time.ts` SQLite-style UTC text timestamps. `tokenStore.ts` OAuth tokens in DB.
- `topLength.ts` target length from ranking pages. `topics.ts` daily news/evergreen topics (10:00 IST).
- `validation.ts` banned phrases, sources, rule checks. `wordImport.ts` .docx -> blog. `wordpress.ts` WP REST (or connector).
- `zoho.ts`/`zohoAuth.ts` Zoho CRM + OAuth. `utils.ts` cn(). `generated/prisma` generated client.
- `assistant/engine.ts` assistant loop (tools, approvals, site_changes). `assistant/prompt.ts` system prompt.
  `assistant/stream.ts` NDJSON stream. `assistant/tools.ts` read/write tools (WP, drafts, settings, PAA, undo).
- `strategy/core.ts` pure strategy rules (tested). `strategy/generate.ts` Claude strategy research.
  `strategy/inputs.ts` real numbers for a strategy. `strategy/jobs.ts` background strategy jobs.
  `strategy/service.ts` read/edit/approve/changes/crawl. `strategy/refresh.ts` cheap update.
  `strategy/progress.ts` progress + cost. `strategy/autopilot.ts` runDaily/runWeekly.
  `strategy/fixer.ts` technical fixes via WP. `strategy/speed.ts` cache plugin + WebP. `strategy/outreach.ts`
  Smartlead backlink outreach. `strategy/directories.ts` daily directory tasks. `strategy/manual.ts` human tasks + guides.
  `strategy/reschedule.ts` pause/resume/reschedule calendar blogs.

## 4. Background work

- `instrumentation.ts` -> `startScheduler()` on the Node runtime (off with `BUILTIN_SCHEDULER=off`).
- On start: requeue blogs left `generating`, re-pend keywords failed by "Interrupted by a server restart".
- `lib/scheduler.ts` `tick()` every 15 min (first after 60 s), wrapped in `runAutomatic` (skipped in Testing mode):
  1. settings `scheduler_heartbeat`; `runDaily()` (one at a time): rewrite rejected blog, draft blogs ahead
     of slot, open 48-h reviews (fact check first), auto-publish due blogs (+IndexNow, GSC sitemap, Bing,
     SE Ranking tracking, internal links), review reminders every 12 h; once a day each (settings guards):
     rank check `last_rank_check`, outreach `last_outreach_run`, speed `last_speed_run` (approved strategy only),
     site checks `last_site_check`, Fireflies sync `last_meeting_sync`; technical fixes every run. Result in `scheduler_last_run`.
  2. `autoResumeAi`, then (unless `ai_paused`) resume restarted strategy + credit-paused blog; prune replay.
  3. `resumeInterruptedBlog`, `fillMissingCovers`, `topicsTick` (after 10:00 IST), `directoriesTick`
     (after 10:00 IST, not awaited, batch mode), `trainingTick` (after 09:00 IST).
  4. Mondays (UTC): `tidyMemories`, `runWeekly` (plan vs actual, AI visibility -> `plan_checks`),
     `topUpTrackedKeywords`, `learnLessons`.
  5. Daily: if no strategy covers the next 3 days, `startStrategyJob` (`last_strategy_check`).
- HTTP crons (`vercel.json`): `/api/skill/auto-check` 03:00 UTC, `/api/strategy/auto-check` 03:30,
  `/api/cron/sweep` 04:00. `/api/cron/daily` and `/api/cron/weekly` can also be hit by an external cron.
- Skill auto-check: regenerates writing skill via Batch API when the active one is >= 15 days old (3 attempts).
- Sweep: keywords `generating` 15+ min with no recent draft -> pending; conversations `running` -> idle /
  awaiting_approval; strategies generating > 3 h -> failed; `stopping` -> stopped. Skips keywords/strategies in Testing mode.

## 5. Prisma models (`prisma/schema.prisma`)

| Model | Purpose | Written by | Read by |
|---|---|---|---|
| keywords | blog keyword queue + progress | keywords/*, generate, blogJob, autopilot, topics, scheduler, sweep, aiReplay, assistant tools | keywords/list, home, progress, status, duplicates |
| drafts | blog drafts (also articles) | blogJob, drafts/*, autopilot, schedule/[id], coverPhoto, originality, articleWriter, assistant | drafts/*, home, reports, lessons, duplicates |
| facts | claims found in a draft | blogJob, autopilot, facts/[id] | drafts/[id], autopilot, assistant |
| settings | key/value config + run guards | lib/settings | everything |
| training_examples | style examples | training/examples | training/examples |
| activity_log | audit trail | lib/activity, auth, team | activity/list, progress, lessons, clientInsights |
| research_digests | research digests | training/digest | training/digest |
| client_insights | meeting insights | clientInsights, client-insights | anthropic (writer context), assistant |
| blog_audits | audits + rewrites | audits, auditJobs, audit/[id]/publish, topics | audit, wordpress/posts, monthlyMetrics |
| image_library | assistant/inline images | assistant/upload, drafts/[id]/images, inlineMedia | assistant |
| draft_images | images placed in a draft | drafts/[id]/images | inlineMedia |
| seo_strategies | monthly strategies | strategy/*, jobs, generate, service, aiCredits, sweep | many (scheduler, autopilot, reports) |
| writing_skills | writing skill versions | skill/generate, skill/auto-check | anthropic, skill/* |
| technical_crawls | Screaming Frog crawls | technical/import, strategy/service | reports, strategy inputs, autopilot |
| assistant_conversations | assistant chats | assistant/engine, sweep | assistant routes |
| assistant_files | chat attachments | assistant/upload | assistant/files, conversations |
| site_changes | reversible website changes | assistant/engine, undo, fixer, speed | assistant, monthlyMetrics |
| paa_questions | People-also-ask bank | questionBank (raw SQL), assistant tools | questionBank, assistant |
| oauth_tokens | Zoho / GBP OAuth tokens | tokenStore, scripts/migrate-sqlite | tokenStore |
| strategy_edits | strategy edit audit log | strategy/service, refresh | strategy/service |
| strategy_changes | mid-month changes | strategy/service | strategy/service |
| strategy_keywords | main keyword per blog, never reused | strategy/service (approve) | generate, inputs, service |
| verified_facts | verified facts register | anthropic (fact check) | anthropic |
| blog_schedule | approved month's calendar | autopilot, schedule/[id], drafts/[id]*, factCheckMark | calendar, home, progress, status |
| backlink_tasks | backlink / directory tasks | outreach, directories, manual, backlinks/[id] | autopilot, progress |
| technical_fix_tasks | technical fixes | fixer, speed, siteChecks, manual | same + progress |
| rank_snapshots | daily priority-keyword ranks | autopilot | autopilot |
| plan_checks | weekly plan vs actual | autopilot runWeekly | (no reader in code) |
| ai_usage | cost per Claude call | aiCredits.recordUsage | ai-credits, progress, refresh |
| team_members | who can sign in, role, blocked | team.ts, team route | auth, team, activity, training |
| topics | daily topics | topics.ts | topics |
| training_profiles / training_lessons / training_tests / training_misses | associate training | associateTraining, associate-training | same |
| site_content | custom-site pages/posts | siteContent, site-content | site/v1/*, site-content |
| ai_replay | saved AI steps | aiReplay | aiReplay |
| access_grants | per-person extra access | team/access | access.ts |
| ai_jobs | Testing-mode queue | aiQueue, agent, ai-credits | agent, progress |
| learning_videos, creative_skills, brand_palettes | Learn from YouTube / skills / palette | **no code in this repo** (schema comments name lib/learning.ts etc., which do not exist here) | - |
| agent_memories | agent memories | agentMemory | agentMemory |

## 6. External tools

| Service | Code | Env / setting (names) | Endpoint / version / model |
|---|---|---|---|
| Anthropic Messages | anthropic.ts, anthropicClient.ts, assistant/engine.ts, strategy/generate.ts, coverPhoto.ts | ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_SECONDARY, ANTHROPIC_MODEL, ASSISTANT_MODEL, STRATEGY_MODEL, FACT_CHECK_MODEL, SECOND_CHECK_MODEL, FACT_CHECK_BRIEF_MODEL, BANNER_MODEL, PROBE_MODEL, FACT_CHECK_*, WRITER_*, *_SEARCHES | SDK; defaults claude-opus-5-5 (writer, assistant, strategy), claude-haiku-5-5 (fact check, banner, probe), claude-sonnet-5-5 (second check); web_search_20260209 (20250305 on Haiku); betas server-side-fallback-2026-07-01, thinking-display-updates-2026-08-18; Batch API (skill, directories) |
| Anthropic Admin cost report | aiCredits.ts | ANTHROPIC_ADMIN_KEY | /v1/organizations/cost_report, anthropic-version 2023-06-01 |
| OpenAI Images | coverPhoto.ts | OPENAI_API_KEY, COVER_IMAGE_MODEL | /v1/images/generations, default gpt-image-2.5-sunburst |
| Pexels | coverPhoto.ts | PEXELS_API_KEY | api.pexels.com/v1/search |
| Google OAuth (sign-in) | auth.ts | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL, ALLOWED_EMAIL_DOMAIN, ADMIN_EMAIL | next-auth Google provider |
| Search Console | searchConsole.ts, indexing.ts | GOOGLE_SERVICE_ACCOUNT_KEY_JSON / _PATH, GSC_SITE_URL, SITEMAP_URL | googleapis searchconsole v1 |
| GA4 Data API | ga4.ts, performanceReport.ts | GA4_PROPERTY_ID (+ service account) | analyticsdata v1beta runReport |
| Business Profile | gbp.ts, gbpAuth.ts | GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REDIRECT_URI; tokens in oauth_tokens | mybusinessaccountmanagement v1, mybusinessbusinessinformation v1 |
| PageSpeed Insights | pagespeed.ts | PAGESPEED_API_KEY | pagespeedonline v5 |
| Clarity | clarity.ts | CLARITY_API_TOKEN | clarity.ms export-data/api/v1/project-live-insights |
| SE Ranking | seranking.ts, aiVisibility.ts, keywordTracking.ts | SERANKING_API_KEY; settings seranking_* , tracked_keyword_target | api.seranking.com/v1 |
| SerpHouse | serphouse.ts | SERPHOUSE_API_KEY | api.serphouse.com/serp/live, /account/info |
| Surfer | surfer.ts | SURFER_API_KEY, SURFER_WORKSPACE_ID | app.surferseo.com |
| Copyscape | originality.ts | COPYSCAPE_USERNAME, COPYSCAPE_API_KEY | copyscape.com/api/ |
| Fireflies | fireflies.ts | FIREFLIES_API_KEY | api.fireflies.ai/graphql |
| Zoho CRM | zoho.ts, zohoAuth.ts, leadAttribution.ts | ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI, ZOHO_ACCOUNTS_URL, ZOHO_API_BASE_URL | crm/v2 |
| Smartlead | smartlead.ts, strategy/outreach.ts | SMARTLEAD_API_KEY, SMARTLEAD_CAMPAIGN_ID, OUTREACH_DAILY_LIMIT | server.smartlead.ai/api/v1 |
| WordPress | wordpress.ts, fixer, speed, siteChecks | WORDPRESS_SITE_URL, WORDPRESS_USERNAME, WORDPRESS_APPLICATION_PASSWORD, TECH_FIX_DAILY_LIMIT; settings blog_authors, wp_author_ids | /wp-json/wp/v2 |
| Custom website connector | siteConnector.ts | SITE_CONNECTOR_URL, SITE_CONNECTOR_SECRET, SITE_CONNECTOR_DRAFTS/_CATEGORIES/_AUTHORS | /_bridge/dashboard-connector.php |
| Custom website webhook / read API | siteContent.ts, site/v1 | SITE_WEBHOOK_URL, SITE_WEBHOOK_SECRET, SITE_API_KEY, SITE_IMPORT_KEY | signed webhook out; /api/site/v1 in |
| Bing Webmaster | bing.ts | BING_WEBMASTER_API_KEY | ssl.bing.com/webmaster/api.svc/json |
| IndexNow | indexing.ts | INDEXNOW_KEY, INDEXNOW_KEY_LOCATION | api.indexnow.org/indexnow |
| Slack | notify.ts | SLACK_WEBHOOK_URL | incoming webhook |
| Social dashboard | socialSkills.ts, links route | SOCIAL_DASHBOARD_URL, SOCIAL_SKILLS_SECRET, SOCIAL_DASHBOARD_LABEL | /api/share/skills, /api/share/banner |
| Exchange rate | app/api/ai-credits (settings usd_inr_rate, usd_inr_at) | none | open.er-api.com/v6/latest/USD |
| Storage | storage.ts | BLOB_READ_WRITE_TOKEN (Vercel Blob) or UPLOADS_DIR | - |
| Postgres | prisma.ts | DATABASE_URL | - |

Other env: CRON_SECRET, DRAFT_EDIT_TOKEN, BUILTIN_SCHEDULER, DASHBOARD_URL, CLAUDE_IDLE_TIMEOUT_MS.

## Notes seen while mapping (for reviewers)
- `/api/site-content` POST changes the live custom website but maps to `content.work`, not `website.change`.
- Legacy "any method" routes accept writes on read endpoints (e.g. POST `/api/ga4/summary` needs settings.change).

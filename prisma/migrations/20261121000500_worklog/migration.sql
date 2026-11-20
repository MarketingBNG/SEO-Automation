-- Phase 7a: the per-task timesheet foundation. Current task, work time blocks, and the watcher token.
-- No Zoho writing here; blocks are stored locally and pushed to Zoho only after a live test.
CREATE TABLE IF NOT EXISTS "work_current" (
  "email" TEXT PRIMARY KEY,
  "task_id" TEXT,
  "task_name" TEXT,
  "project_id" TEXT,
  "project_name" TEXT,
  "entry_id" INTEGER,
  "since" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "set_by" TEXT
);

CREATE TABLE IF NOT EXISTS "work_entries" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "task_id" TEXT,
  "task_name" TEXT,
  "project_id" TEXT,
  "started_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "ended_at" TEXT,
  "active_ms" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'watcher',
  "logged_at" TEXT,
  "zoho_log_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE INDEX IF NOT EXISTS "work_entries_email_day_idx" ON "work_entries"("email", "day");

CREATE TABLE IF NOT EXISTS "work_tokens" (
  "email" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_tokens_token_key" ON "work_tokens"("token");

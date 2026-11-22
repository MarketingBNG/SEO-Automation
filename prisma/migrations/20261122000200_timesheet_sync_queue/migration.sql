-- On confirmed Finished, prior worked days are enqueued here for Zoho Projects timesheet sync. One row
-- per (email, work day) prevents duplicate entries across retries and restarts; work_attendance.logged_at
-- is the ultimate idempotency key (a day logged once is never re-posted).
CREATE TABLE IF NOT EXISTS "timesheet_sync_queue" (
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "zoho_log_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "updated_at" TEXT,
  PRIMARY KEY ("email", "day")
);
CREATE INDEX IF NOT EXISTS "timesheet_sync_queue_status_idx" ON "timesheet_sync_queue" ("status");

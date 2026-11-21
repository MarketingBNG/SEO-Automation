-- The activity watcher model: a daily attendance span and per-app active time (what they did).
CREATE TABLE IF NOT EXISTS "work_attendance" (
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "first_at" TEXT NOT NULL,
  "last_at" TEXT NOT NULL,
  "logged_at" TEXT,
  "zoho_log_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  PRIMARY KEY ("email", "day")
);

CREATE TABLE IF NOT EXISTS "work_activity" (
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "app" TEXT NOT NULL,
  "active_ms" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("email", "day", "app")
);

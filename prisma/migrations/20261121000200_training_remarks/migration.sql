-- Phase 4: remarks on a person's training, written by the admin or their team's manager.
CREATE TABLE IF NOT EXISTS "training_remarks" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "author_name" TEXT,
  "week" TEXT,
  "level" INTEGER,
  "percent" INTEGER,
  "level_up" BOOLEAN NOT NULL DEFAULT false,
  "text" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE INDEX IF NOT EXISTS "training_remarks_email_idx" ON "training_remarks"("email");

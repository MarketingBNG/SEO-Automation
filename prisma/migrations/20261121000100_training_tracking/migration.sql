-- Phase 2: timing, the full answer trail, and AI-use signals for the training report.
-- All additive. No existing data changes; old tests simply have these columns empty.
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "opened_at" TEXT;
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "answer_log" TEXT;
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "signals" TEXT;

-- When a person first opened a lesson (lesson time = read_at - opened_at). A separate table because a
-- training_reads row means "read" and unlocks the gate; opening is not reading.
CREATE TABLE IF NOT EXISTS "training_lesson_opens" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "lesson_id" INTEGER NOT NULL,
  "opened_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS "training_lesson_opens_email_lesson_id_key" ON "training_lesson_opens"("email", "lesson_id");

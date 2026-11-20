-- Training v2: three lessons a day (Technical, Know UIC, Marketing) for associates and managers,
-- lessons marked read, a weekly surprise test, adaptive levels with their history, game rounds,
-- and each lesson's walkthrough slides and videos. Only new nullable or defaulted columns and new
-- tables; the two unique keys are widened (existing rows stay unique under the wider key).
ALTER TABLE "training_lessons" ADD COLUMN IF NOT EXISTS "track" TEXT NOT NULL DEFAULT 'technical';
ALTER TABLE "training_lessons" ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'associate';
ALTER TABLE "training_lessons" ADD COLUMN IF NOT EXISTS "topic" TEXT;
ALTER TABLE "training_lessons" ADD COLUMN IF NOT EXISTS "extras" TEXT;
DROP INDEX IF EXISTS "training_lessons_day_level_key";
CREATE UNIQUE INDEX IF NOT EXISTS "training_lessons_day_level_track_audience_key" ON "training_lessons"("day", "level", "track", "audience");

ALTER TABLE "training_profiles" ADD COLUMN IF NOT EXISTS "lesson_ids" TEXT;
ALTER TABLE "training_profiles" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "lesson_ids" TEXT;
DROP INDEX IF EXISTS "training_tests_email_day_key";
CREATE UNIQUE INDEX IF NOT EXISTS "training_tests_email_day_kind_key" ON "training_tests"("email", "day", "kind");

CREATE TABLE IF NOT EXISTS "training_reads" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "read_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "training_reads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "training_reads_email_lesson_id_key" ON "training_reads"("email", "lesson_id");

CREATE TABLE IF NOT EXISTS "training_level_history" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "reason" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "training_level_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "training_level_history_email_idx" ON "training_level_history"("email");

CREATE TABLE IF NOT EXISTS "training_games" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "max_points" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "training_games_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "training_games_email_lesson_id_key" ON "training_games"("email", "lesson_id");

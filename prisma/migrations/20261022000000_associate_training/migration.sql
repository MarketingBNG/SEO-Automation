-- Associate Training: a short daily lesson per level, a next-day test, and wrong answers asked again.
CREATE TABLE "training_profiles" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "level" INTEGER NOT NULL DEFAULT 1,
  "streak" INTEGER NOT NULL DEFAULT 0,
  "lesson_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE TABLE "training_lessons" (
  "id" SERIAL PRIMARY KEY,
  "day" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content_html" TEXT NOT NULL,
  "sources" TEXT,
  "questions" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE UNIQUE INDEX "training_lessons_day_level_key" ON "training_lessons"("day", "level");
CREATE TABLE "training_tests" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "lesson_id" INTEGER,
  "questions" TEXT NOT NULL,
  "answers" TEXT,
  "score" INTEGER,
  "total" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "submitted_at" TEXT
);
CREATE UNIQUE INDEX "training_tests_email_day_key" ON "training_tests"("email", "day");
CREATE TABLE "training_misses" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "due_day" TEXT NOT NULL,
  "tries" INTEGER NOT NULL DEFAULT 1,
  "cleared" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE INDEX "training_misses_email_idx" ON "training_misses"("email", "cleared", "due_day");

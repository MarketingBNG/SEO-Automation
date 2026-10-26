-- Learn from YouTube (lib/learning.ts): the videos the dashboard watches with Gemini and the notes it
-- takes, and the creative skills built from those notes (one per category, plus a master skill).
CREATE TABLE "learning_videos" (
    "id" SERIAL NOT NULL,
    "video_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "channel" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "sort_order" INTEGER,
    "level" TEXT,
    "duration_sec" INTEGER,
    "note" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "notes" TEXT,
    "parts_total" INTEGER,
    "parts_done" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "model" TEXT,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "watched_seconds" INTEGER NOT NULL DEFAULT 0,
    "added_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "watched_at" TEXT,
    CONSTRAINT "learning_videos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_videos_video_id_key" ON "learning_videos"("video_id");
CREATE INDEX "learning_videos_status_idx" ON "learning_videos"("status");
CREATE INDEX "learning_videos_category_idx" ON "learning_videos"("category");

CREATE TABLE "creative_skills" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sources" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "built_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "creative_skills_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "creative_skills_slug_status_idx" ON "creative_skills"("slug", "status");

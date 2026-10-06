-- AlterTable
ALTER TABLE "seo_strategies" ADD COLUMN     "approved_at" TEXT,
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "approved_version" INTEGER,
ADD COLUMN     "plan_json" TEXT,
ADD COLUMN     "validation" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "technical_crawls" ADD COLUMN     "file_key" TEXT,
ADD COLUMN     "link_issues" TEXT,
ADD COLUMN     "links_count" INTEGER,
ADD COLUMN     "uploaded_by" TEXT;

-- CreateTable
CREATE TABLE "strategy_edits" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "reviewer" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "version" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "strategy_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_changes" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "what" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "strategy_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_keywords" (
    "id" SERIAL NOT NULL,
    "keyword_key" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "strategy_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_facts" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "source_url" TEXT,
    "verified_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "verified_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_schedule" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "publish_at" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "main_keyword" TEXT NOT NULL,
    "cluster" TEXT,
    "tags" TEXT NOT NULL,
    "refresh_url" TEXT,
    "keyword_id" INTEGER,
    "draft_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "review_started" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TEXT,
    "approval_mode" TEXT,
    "hold_reasons" TEXT,
    "wp_post_url" TEXT,
    "post_publish_log" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "blog_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlink_tasks" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "target_site" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "our_page" TEXT NOT NULL,
    "send_date" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "backlink_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_snapshots" (
    "id" SERIAL NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "checked_on" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_checks" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "week_of" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "plan_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_edits_strategy_id_idx" ON "strategy_edits"("strategy_id");

-- CreateIndex
CREATE INDEX "strategy_changes_strategy_id_idx" ON "strategy_changes"("strategy_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_keywords_keyword_key_key" ON "strategy_keywords"("keyword_key");

-- CreateIndex
CREATE INDEX "blog_schedule_status_idx" ON "blog_schedule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rank_snapshots_keyword_checked_on_key" ON "rank_snapshots"("keyword", "checked_on");


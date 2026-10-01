-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "keywords" (
    "id" SERIAL NOT NULL,
    "batch_name" TEXT,
    "keyword" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" SERIAL NOT NULL,
    "keyword_id" INTEGER NOT NULL,
    "title" TEXT,
    "meta_description" TEXT,
    "content_html" TEXT,
    "research_notes" TEXT,
    "production_state" TEXT,
    "repair_attempts" INTEGER NOT NULL DEFAULT 0,
    "validation_issues" TEXT,
    "word_count" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "featured_image_path" TEXT,
    "wp_post_id" INTEGER,
    "wp_post_url" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "target_wp_post_id" INTEGER,
    "validation_warnings" TEXT,
    "people_also_ask" TEXT,
    "keyword_plan" TEXT,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "fact_id" TEXT,
    "claim" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "jurisdiction" TEXT,
    "effective_date" TEXT,
    "applicability" TEXT,
    "exceptions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'needs_verify',
    "reviewer" TEXT,
    "review_date" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "training_examples" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "content_html" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "training_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" INTEGER,
    "details" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_digests" (
    "id" SERIAL NOT NULL,
    "topic" TEXT,
    "summary" TEXT NOT NULL,
    "sources" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "decided_at" TEXT,

    CONSTRAINT "research_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_insights" (
    "id" SERIAL NOT NULL,
    "transcript_id" TEXT,
    "title" TEXT,
    "meeting_date" TEXT,
    "overview" TEXT,
    "action_items" TEXT,
    "keywords" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "decided_at" TEXT,

    CONSTRAINT "client_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_audits" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "source_url" TEXT,
    "content_html" TEXT,
    "verdict" TEXT,
    "summary" TEXT,
    "issues" TEXT,
    "suggestions" TEXT,
    "facts" TEXT,
    "word_count" INTEGER,
    "wp_post_id" INTEGER,
    "wp_post_url" TEXT,
    "rewrite_title" TEXT,
    "rewrite_content_html" TEXT,
    "rewrite_status" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "rewrite_meta" TEXT,
    "people_also_ask" TEXT,
    "rewrite_people_also_ask" TEXT,

    CONSTRAINT "blog_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_library" (
    "id" SERIAL NOT NULL,
    "filename" TEXT,
    "path" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "model_path" TEXT,
    "mime_type" TEXT,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "image_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_images" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "image_id" INTEGER NOT NULL,
    "is_featured" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "draft_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_strategies" (
    "id" SERIAL NOT NULL,
    "period" TEXT,
    "summary" TEXT,
    "keyword_priorities" TEXT,
    "content_recommendations" TEXT,
    "technical_recommendations" TEXT,
    "competitor_notes" TEXT,
    "data_snapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "decided_at" TEXT,
    "report_json" TEXT,

    CONSTRAINT "seo_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_skills" (
    "id" SERIAL NOT NULL,
    "skill_content" TEXT NOT NULL,
    "research_summary" TEXT,
    "sources" TEXT,
    "own_performance_notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "writing_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_crawls" (
    "id" SERIAL NOT NULL,
    "filename" TEXT,
    "total_urls" INTEGER,
    "broken_count" INTEGER,
    "missing_title_count" INTEGER,
    "duplicate_title_count" INTEGER,
    "missing_meta_count" INTEGER,
    "thin_content_count" INTEGER,
    "problem_urls" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "technical_crawls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "messages" TEXT NOT NULL DEFAULT '[]',
    "pending" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_changes" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER,
    "tool" TEXT NOT NULL,
    "summary" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "undo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "undone_at" TEXT,

    CONSTRAINT "site_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paa_questions" (
    "id" SERIAL NOT NULL,
    "question_key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "keyword" TEXT,
    "markets" TEXT,
    "times_seen" INTEGER NOT NULL DEFAULT 1,
    "first_seen" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "last_seen" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "paa_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "provider" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE INDEX "keywords_status_idx" ON "keywords"("status");

-- CreateIndex
CREATE INDEX "facts_draft_id_idx" ON "facts"("draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "paa_questions_question_key_key" ON "paa_questions"("question_key");

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_images" ADD CONSTRAINT "draft_images_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_images" ADD CONSTRAINT "draft_images_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "image_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

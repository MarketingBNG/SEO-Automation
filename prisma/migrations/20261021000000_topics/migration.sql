-- Daily topic research (what to write about today) and the LinkedIn article kind of draft.
CREATE TABLE "topics" (
  "id" SERIAL PRIMARY KEY,
  "day" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "why" TEXT,
  "keywords" TEXT,
  "sources" TEXT,
  "kind" TEXT,
  "carried_over" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "draft_id" INTEGER,
  "article_draft_id" INTEGER,
  "audit_id" INTEGER,
  "comparison" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE INDEX "topics_day_idx" ON "topics"("day");
ALTER TABLE "drafts" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'blog';

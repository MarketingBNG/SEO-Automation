-- Website content served to the new custom website through /api/site/v1 (pages and blog posts).
CREATE TABLE "site_content" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "meta_description" TEXT,
  "canonical" TEXT,
  "og_image" TEXT,
  "schema" TEXT,
  "sections" TEXT,
  "html" TEXT,
  "cover" TEXT,
  "author" TEXT,
  "categories" TEXT,
  "tags" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published',
  "published_at" TEXT,
  "updated_by" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
CREATE INDEX "site_content_type_status_idx" ON "site_content"("type", "status");
-- Match the index name Prisma expects for the training misses index.
ALTER INDEX "training_misses_email_idx" RENAME TO "training_misses_email_cleared_due_day_idx";

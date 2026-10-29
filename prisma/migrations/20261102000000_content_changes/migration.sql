-- Change tracking: what changed in a blog's words, how much and by whom; re-uploads matched to the
-- earlier upload; audits started from a draft (Optimise for SEO, AEO and GEO).
ALTER TABLE "blog_audits" ADD COLUMN "previous_audit_id" INTEGER;
ALTER TABLE "blog_audits" ADD COLUMN "changes_summary" TEXT;
ALTER TABLE "blog_audits" ADD COLUMN "draft_id" INTEGER;
ALTER TABLE "blog_audits" ADD COLUMN "mode" TEXT;
CREATE TABLE "content_changes" (
  "id" SERIAL PRIMARY KEY,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "actor" TEXT,
  "title" TEXT,
  "changed_pct" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "report" TEXT NOT NULL,
  "before_html" TEXT,
  "previous_id" INTEGER,
  "learned" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE INDEX "content_changes_entity_type_entity_id_idx" ON "content_changes"("entity_type", "entity_id");
CREATE INDEX "content_changes_learned_idx" ON "content_changes"("learned");

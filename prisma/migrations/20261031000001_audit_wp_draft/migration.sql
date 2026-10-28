-- The separate WordPress draft an audit rewrite was sent as (the live post unchanged), so the audit
-- page links to it after a reload and a later send updates that draft instead of making another.
ALTER TABLE "blog_audits" ADD COLUMN "rewrite_wp_draft_url" TEXT;
ALTER TABLE "blog_audits" ADD COLUMN "rewrite_wp_draft_id" INTEGER;

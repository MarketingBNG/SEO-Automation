-- Audits and rewrites run in the background (the request returns at once and the page polls),
-- so the row carries the job state and any error instead of the request holding the answer.
ALTER TABLE "blog_audits" ADD COLUMN "audit_status" TEXT;
ALTER TABLE "blog_audits" ADD COLUMN "audit_error" TEXT;
ALTER TABLE "blog_audits" ADD COLUMN "rewrite_error" TEXT;

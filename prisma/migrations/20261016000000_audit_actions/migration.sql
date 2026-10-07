-- CA/CPA reviewer, overdue reminders, per-blog CTA and the LinkedIn post.
ALTER TABLE "blog_schedule" ADD COLUMN "expert_reviewer" TEXT;
ALTER TABLE "blog_schedule" ADD COLUMN "reminded_at" TEXT;
ALTER TABLE "blog_schedule" ADD COLUMN "cta" TEXT;
ALTER TABLE "drafts" ADD COLUMN "linkedin_post" TEXT;
ALTER TABLE "drafts" ADD COLUMN "length_target" TEXT;
ALTER TABLE "verified_facts" ADD COLUMN "jurisdiction" TEXT;
ALTER TABLE "verified_facts" ADD COLUMN "times_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "verified_facts" ADD COLUMN "last_checked_at" TEXT;
DELETE FROM "verified_facts" a USING "verified_facts" b WHERE a."claim" = b."claim" AND a."id" > b."id";
CREATE UNIQUE INDEX "verified_facts_claim_key" ON "verified_facts"("claim");

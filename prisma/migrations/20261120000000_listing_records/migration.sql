-- Listings and other tasks a person does stay on the dashboard after they are ticked: who marked
-- them done and when, the listing's address and the person's notes (login email, username; never a
-- password). Nullable, so every existing row stays as it is.
ALTER TABLE "backlink_tasks" ADD COLUMN IF NOT EXISTS "done_at" TEXT;
ALTER TABLE "backlink_tasks" ADD COLUMN IF NOT EXISTS "done_by" TEXT;
ALTER TABLE "backlink_tasks" ADD COLUMN IF NOT EXISTS "done_by_email" TEXT;
ALTER TABLE "backlink_tasks" ADD COLUMN IF NOT EXISTS "listing_url" TEXT;
ALTER TABLE "backlink_tasks" ADD COLUMN IF NOT EXISTS "listing_notes" TEXT;
ALTER TABLE "technical_fix_tasks" ADD COLUMN IF NOT EXISTS "done_at" TEXT;
ALTER TABLE "technical_fix_tasks" ADD COLUMN IF NOT EXISTS "done_by" TEXT;
ALTER TABLE "technical_fix_tasks" ADD COLUMN IF NOT EXISTS "done_by_email" TEXT;
ALTER TABLE "technical_fix_tasks" ADD COLUMN IF NOT EXISTS "listing_url" TEXT;
ALTER TABLE "technical_fix_tasks" ADD COLUMN IF NOT EXISTS "listing_notes" TEXT;

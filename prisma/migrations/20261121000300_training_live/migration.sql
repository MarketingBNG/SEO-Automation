-- Phase 5: the live test view. The in-progress answers and when they last changed, so the admin or a
-- manager can watch a test as it is taken. Cleared is fine to leave after submit; the report uses the
-- final answers, not these.
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "live" TEXT;
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "live_at" TEXT;

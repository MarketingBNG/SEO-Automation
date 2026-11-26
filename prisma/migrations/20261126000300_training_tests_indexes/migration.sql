-- Speed up the training gate, the live test view and the results lists (they filter tests by status).
CREATE INDEX IF NOT EXISTS "training_tests_status_live_at_idx" ON "training_tests"("status", "live_at");
CREATE INDEX IF NOT EXISTS "training_tests_email_status_idx" ON "training_tests"("email", "status");

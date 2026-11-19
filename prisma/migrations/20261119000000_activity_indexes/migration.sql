-- The activity log only grows (about 200,000 rows after a year of the scheduler and the team).
-- Without these, the header progress poll (every open tab, every 5-20 s), the Learning page and the
-- Drafts & Review list each read the whole table: 30-40 ms per call at 200,000 rows, 1-3 ms with them.
CREATE INDEX IF NOT EXISTS "activity_log_created_at_idx" ON "activity_log"("created_at");
CREATE INDEX IF NOT EXISTS "activity_log_entity_type_entity_id_idx" ON "activity_log"("entity_type", "entity_id");
-- Every draft open, cover, edit and publish looks up its calendar row by draft.
CREATE INDEX IF NOT EXISTS "blog_schedule_draft_id_idx" ON "blog_schedule"("draft_id");

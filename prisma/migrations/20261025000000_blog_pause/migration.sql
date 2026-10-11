-- Pausing a calendar blog: the status it returns to, and who paused it.
ALTER TABLE "blog_schedule" ADD COLUMN "paused_from" TEXT;
ALTER TABLE "blog_schedule" ADD COLUMN "paused_by" TEXT;

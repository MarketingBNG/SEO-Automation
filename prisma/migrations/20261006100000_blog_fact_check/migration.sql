-- Automatic fact-check result per scheduled blog (additive).
ALTER TABLE "blog_schedule" ADD COLUMN "fact_check" TEXT;

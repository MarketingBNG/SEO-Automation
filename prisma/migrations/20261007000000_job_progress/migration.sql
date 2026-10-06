-- Live progress for background strategy generation and blog writing (additive).
ALTER TABLE "seo_strategies" ADD COLUMN "progress_stage" TEXT;
ALTER TABLE "seo_strategies" ADD COLUMN "progress_percent" INTEGER;
ALTER TABLE "seo_strategies" ADD COLUMN "error" TEXT;
ALTER TABLE "keywords" ADD COLUMN "progress_stage" TEXT;
ALTER TABLE "keywords" ADD COLUMN "progress_percent" INTEGER;

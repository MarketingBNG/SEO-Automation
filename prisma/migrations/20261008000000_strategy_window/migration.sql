-- Strategy covers 30 days from the day it is generated (additive).
ALTER TABLE "seo_strategies" ADD COLUMN "start_date" TEXT;
ALTER TABLE "seo_strategies" ADD COLUMN "end_date" TEXT;

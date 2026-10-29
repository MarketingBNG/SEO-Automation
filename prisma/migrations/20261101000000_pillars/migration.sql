-- The three pillars (Visibility, Traction, Conversion): which one a calendar blog or a topic serves.
ALTER TABLE "blog_schedule" ADD COLUMN "pillar" TEXT;
ALTER TABLE "topics" ADD COLUMN "pillar" TEXT;

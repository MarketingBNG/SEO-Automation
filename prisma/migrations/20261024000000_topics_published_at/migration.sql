-- When a news topic's source was published, so only the last 24 hours are shown.
ALTER TABLE "topics" ADD COLUMN "published_at" TEXT;

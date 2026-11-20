-- The publish checklist (Author, Title, Blog text, Banner) ticked before a blog is published or
-- approved: JSON {item: {fp, by, at}}. Nullable; existing drafts simply have no ticks yet.
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "publish_checklist" TEXT;

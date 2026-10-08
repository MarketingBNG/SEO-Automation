-- Alt text for the cover image (what the picture shows, for Google and screen readers). Empty
-- means the post title is used.
ALTER TABLE "drafts" ADD COLUMN "cover_alt" TEXT;

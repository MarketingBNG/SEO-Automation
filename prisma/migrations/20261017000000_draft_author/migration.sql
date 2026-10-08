-- The partner a draft is published under is chosen when the draft is written, so the Word preview
-- and the live post show the same name.
ALTER TABLE "drafts" ADD COLUMN "author" TEXT;

-- Body images placed in a draft remember their WordPress Media Library copy, so a publish that
-- runs again does not upload them twice.
ALTER TABLE "image_library" ADD COLUMN "wp_media_id" INTEGER;
ALTER TABLE "image_library" ADD COLUMN "wp_url" TEXT;

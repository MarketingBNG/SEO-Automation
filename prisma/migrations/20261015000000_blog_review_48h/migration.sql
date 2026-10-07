-- AlterTable
ALTER TABLE "blog_schedule" ADD COLUMN "author" TEXT,
ADD COLUMN "reject_feedback" TEXT,
ADD COLUMN "rejected_by" TEXT,
ADD COLUMN "revision_note" TEXT,
ADD COLUMN "revisions" INTEGER NOT NULL DEFAULT 0;

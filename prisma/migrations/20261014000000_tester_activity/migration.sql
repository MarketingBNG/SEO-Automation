-- AlterTable
ALTER TABLE "activity_log" ADD COLUMN "actor_email" TEXT,
ADD COLUMN "source" TEXT;

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN "role_expires_at" TEXT;

-- CreateIndex
CREATE INDEX "activity_log_actor_email_idx" ON "activity_log"("actor_email");

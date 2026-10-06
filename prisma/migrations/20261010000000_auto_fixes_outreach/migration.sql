-- AlterTable
ALTER TABLE "backlink_tasks" ADD COLUMN "contact_email" TEXT,
ADD COLUMN "email_subject" TEXT,
ADD COLUMN "email_body" TEXT,
ADD COLUMN "sent_at" TEXT,
ADD COLUMN "followup_at" TEXT,
ADD COLUMN "verified_at" TEXT,
ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "technical_fix_tasks" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "fix" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "result" TEXT,
    "applied_at" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "technical_fix_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_fix_tasks_strategy_id_idx" ON "technical_fix_tasks"("strategy_id");

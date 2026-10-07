-- CreateTable
CREATE TABLE "team_members" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_members_email_key" ON "team_members"("email");

-- The owner is the admin.
INSERT INTO "team_members" ("email", "name", "role") VALUES ('abhuday@usaindiacfo.com', 'Abhuday Tripathi', 'admin') ON CONFLICT ("email") DO UPDATE SET "role" = 'admin', "blocked" = false;

-- AlterTable
ALTER TABLE "backlink_tasks" ADD COLUMN "assigned_to" TEXT;

-- AlterTable
ALTER TABLE "technical_fix_tasks" ADD COLUMN "assigned_to" TEXT;

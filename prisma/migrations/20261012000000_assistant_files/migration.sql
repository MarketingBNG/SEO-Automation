-- AlterTable
ALTER TABLE "assistant_conversations" ADD COLUMN "created_by" TEXT;

-- CreateTable
CREATE TABLE "assistant_files" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),

    CONSTRAINT "assistant_files_pkey" PRIMARY KEY ("id")
);

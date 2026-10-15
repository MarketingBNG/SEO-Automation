-- Finished AI steps of a blog or strategy run, so a run that stopped (credits, restart) and is
-- started again reuses them instead of paying for them twice. Deleted when the run finishes.
CREATE TABLE "ai_replay" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "ai_replay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_replay_scope_hash_key" ON "ai_replay"("scope", "hash");

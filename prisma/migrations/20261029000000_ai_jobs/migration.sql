-- Testing mode (lib/aiQueue.ts): AI requests wait here for Claude Code (scripts/agent.ts) to answer
-- them on the owner's subscription, instead of going to the Anthropic API.
CREATE TABLE "ai_jobs" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT,
    "label" TEXT,
    "web_search" BOOLEAN NOT NULL DEFAULT false,
    "system" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "answer" TEXT,
    "answered_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "answered_at" TEXT,
    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs"("status");
CREATE INDEX "ai_jobs_hash_idx" ON "ai_jobs"("hash");

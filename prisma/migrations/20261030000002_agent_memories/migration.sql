-- Agent memory (lib/agentMemory.ts): what each dashboard agent has learned (mistakes, lessons, the
-- team's preferences, incidents and development changes), so results improve and mistakes are not
-- repeated. The same lesson seen again raises its strength instead of adding a copy.
CREATE TABLE "agent_memories" (
    "id" SERIAL NOT NULL,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "strength" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "last_seen_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "resolved_at" TEXT,
    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_memories_agent_key_key" ON "agent_memories"("agent", "key");
CREATE INDEX "agent_memories_agent_status_idx" ON "agent_memories"("agent", "status");

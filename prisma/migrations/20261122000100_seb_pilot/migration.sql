-- SEB pilot: short-lived single-use identity handoff, the SEB session it mints, and the idempotent
-- Zoho People attendance punch (one per employee per IST day).

CREATE TABLE IF NOT EXISTS "seb_handoffs" (
  "code" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "expires_at" TEXT NOT NULL,
  "used_at" TEXT,
  PRIMARY KEY ("code")
);
CREATE INDEX IF NOT EXISTS "seb_handoffs_email_idx" ON "seb_handoffs" ("email");

CREATE TABLE IF NOT EXISTS "seb_sessions" (
  "token" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "expires_at" TEXT NOT NULL,
  PRIMARY KEY ("token")
);
CREATE INDEX IF NOT EXISTS "seb_sessions_email_idx" ON "seb_sessions" ("email");

CREATE TABLE IF NOT EXISTS "attendance_punches" (
  "email" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "zoho_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "attempt_at" TEXT,
  "note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "updated_at" TEXT,
  PRIMARY KEY ("email", "day")
);

-- Phase 6: the monitoring-terms consent record (DPDP): who agreed, to which version, and when.
CREATE TABLE IF NOT EXISTS "training_consents" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "accepted_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS "training_consents_email_version_key" ON "training_consents"("email", "version");

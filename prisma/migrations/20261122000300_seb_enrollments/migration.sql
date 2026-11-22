-- One-time SEB device enrollment: the first handoff code links an employee to a Windows user on a
-- device and creates a long-lived, REVOCABLE credential (only its hash is stored here; the plaintext
-- lives in Windows secure storage). On each later launch the launcher exchanges it for a fresh SEB
-- session. A code is needed again only if the enrollment is revoked or a different Windows user signs in.
CREATE TABLE IF NOT EXISTS "seb_enrollments" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "windows_user" TEXT NOT NULL,
  "secret_hash" TEXT NOT NULL,
  "label" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
  "last_used_at" TEXT,
  "revoked_at" TEXT,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "seb_enrollments_email_idx" ON "seb_enrollments" ("email");
CREATE INDEX IF NOT EXISTS "seb_enrollments_windows_user_idx" ON "seb_enrollments" ("windows_user");

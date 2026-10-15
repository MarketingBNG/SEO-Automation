-- Extra access the admin gives one person: a page or an action, for good or until a time.
CREATE TABLE "access_grants" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "grant_key" TEXT NOT NULL,
    "expires_at" TEXT,
    "granted_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "access_grants_email_idx" ON "access_grants"("email");

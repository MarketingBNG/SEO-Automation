-- What the person asked for a blog uploaded in Check a blog ("only SEO and backlinks, keep my words
-- and facts"), followed by its audit and rewrite. Nullable: existing audits are unchanged.
ALTER TABLE "blog_audits" ADD COLUMN "instructions" TEXT;

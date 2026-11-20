-- A person's team (marketing | automation). A manager sees the training report of their own team
-- only; the admin sees everyone. Null until the admin sets it (no one is scoped out by surprise:
-- a manager with no team set sees no report rows until their team is chosen).
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "team" TEXT;

-- Brand Palette (lib/brandPalette.ts): a brief, the directions generated for it (colours, type,
-- rules, self-critique) with the contrast checks computed in code, and the one chosen.
CREATE TABLE "brand_palettes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "error" TEXT,
    "chosen" INTEGER,
    "parent_id" INTEGER,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    "updated_at" TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT "brand_palettes_pkey" PRIMARY KEY ("id")
);

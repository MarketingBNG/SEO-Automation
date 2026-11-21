-- Typed (written-answer) questions: the person's typed answers (with keystroke stats) and the AI's
-- grade of each. Additive; multiple-choice-only tests just leave these empty.
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "written" TEXT;
ALTER TABLE "training_tests" ADD COLUMN IF NOT EXISTS "written_grades" TEXT;

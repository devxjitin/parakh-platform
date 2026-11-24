-- Keep question IDs, answers, scores and historical judging data.
-- Existing coding prompts become written answers. Any ungraded submissions can be marked by a trainer.
BEGIN;
ALTER TYPE "QuestionType" RENAME TO "QuestionType_old";
CREATE TYPE "QuestionType" AS ENUM ('SINGLE', 'MULTI', 'SUBJECTIVE');
ALTER TABLE "Question" ALTER COLUMN "type" TYPE "QuestionType"
USING (CASE WHEN "type"::text = 'CODING' THEN 'SUBJECTIVE' ELSE "type"::text END)::"QuestionType";
DROP TYPE "QuestionType_old";
COMMIT;

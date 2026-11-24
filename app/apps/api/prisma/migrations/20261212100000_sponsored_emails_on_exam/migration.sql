-- Trainer-pays exams: the invited student emails are fixed when the exam is published.
ALTER TABLE "Exam" ADD COLUMN "sponsoredEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Exam" SET "sponsoredEmails" = ARRAY[]::TEXT[] WHERE "sponsoredEmails" IS NULL;
ALTER TABLE "Exam" ALTER COLUMN "sponsoredEmails" SET NOT NULL;

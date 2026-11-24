-- The single results email (score, certificate, answer sheet) is sent once per student.
ALTER TABLE "Attempt" ADD COLUMN "resultEmailedAt" TIMESTAMP(3),
ADD COLUMN "resultEmailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "resultEmailLockUntil" TIMESTAMP(3);

-- Students whose results were already published before this change were told by the old emails.
UPDATE "Attempt" SET "resultEmailedAt" = COALESCE("gradedAt", NOW()) WHERE "status" = 'RESULT_PUBLISHED';

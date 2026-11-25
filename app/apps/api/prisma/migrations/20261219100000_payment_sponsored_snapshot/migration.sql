-- Sponsored seat list is frozen on the creation payment so capture can never grant more (or fewer)
-- seats than were paid for.
ALTER TABLE "Payment" ADD COLUMN "sponsoredEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Payment" p SET "sponsoredEmails" = e."sponsoredEmails"
  FROM "Exam" e WHERE p."examId" = e."id" AND p."purpose" = 'EXAM_CREATION' AND p."status" = 'CREATED';
UPDATE "Payment" SET "sponsoredEmails" = ARRAY[]::TEXT[] WHERE "sponsoredEmails" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "sponsoredEmails" SET NOT NULL;

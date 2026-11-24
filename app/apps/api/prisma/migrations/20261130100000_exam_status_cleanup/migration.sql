-- Drops exam statuses that were never set and adds CANCELLED. Any row still using a dropped
-- value is mapped to the nearest real state first.
UPDATE "Exam" SET "status" = 'DRAFT' WHERE "status" = 'PAYMENT_PENDING';
UPDATE "Exam" SET "status" = 'PUBLISHED' WHERE "status" IN ('LIVE', 'CLOSED', 'GRADING');
UPDATE "Exam" SET "status" = 'RESULTS_FINAL' WHERE "status" IN ('CERT_PENDING_APPROVAL', 'CERT_RELEASED');

ALTER TYPE "ExamStatus" RENAME TO "ExamStatus_old";
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RESULTS_FINAL', 'CANCELLED');
ALTER TABLE "Exam" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Exam" ALTER COLUMN "status" TYPE "ExamStatus" USING ("status"::text::"ExamStatus");
ALTER TABLE "Exam" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ExamStatus_old";

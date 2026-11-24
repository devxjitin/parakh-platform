-- Students join with an exam code and an emailed code (no accounts); NandiVex can run exams itself;
-- practice sets open with a code emailed after the exam closes.
ALTER TYPE "OtpPurpose" ADD VALUE 'JOIN';

ALTER TABLE "Exam" ADD COLUMN "nandivexHosted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exam" ADD COLUMN "studentFeePaise" INTEGER;

ALTER TABLE "PracticeAccess" ADD COLUMN "code" TEXT;
ALTER TABLE "PracticeAccess" ADD COLUMN "emailedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PracticeAccess_code_key" ON "PracticeAccess"("code");

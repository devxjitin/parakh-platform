-- Always-open exams: admin-made exams with no window, one attempt per payment, released per attempt.
ALTER TABLE "Exam" ADD COLUMN "alwaysOpen" BOOLEAN NOT NULL DEFAULT false;
-- Public "Available exams" list: shown on the landing page and in the app while the exam is published.
ALTER TABLE "Exam" ADD COLUMN "listedPublicly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exam" ADD COLUMN "catalogSummary" TEXT;
ALTER TABLE "Exam" ADD COLUMN "catalogTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Exam" SET "catalogTopics" = ARRAY[]::TEXT[] WHERE "catalogTopics" IS NULL;
ALTER TABLE "Exam" ALTER COLUMN "catalogTopics" SET NOT NULL;
CREATE INDEX "Exam_listedPublicly_status_idx" ON "Exam"("listedPublicly", "status");

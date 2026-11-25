-- A student can take an always-open exam again once their result has gone out. The old seat is kept
-- as history and marked superseded; only one live seat per student and exam is allowed.
ALTER TABLE "Enrollment" ADD COLUMN "supersededAt" TIMESTAMP(3);

DROP INDEX "Enrollment_examId_studentId_key";

CREATE UNIQUE INDEX "Enrollment_examId_studentId_live_key"
  ON "Enrollment"("examId", "studentId")
  WHERE "supersededAt" IS NULL;

CREATE INDEX "Enrollment_examId_studentId_idx" ON "Enrollment"("examId", "studentId");

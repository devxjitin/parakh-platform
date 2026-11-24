-- Sprint 7: integrity hardening
ALTER TABLE "Exam" ADD COLUMN "questionsPerStudent" INTEGER;

ALTER TABLE "Attempt" ADD COLUMN "deviceId" TEXT,
ADD COLUMN "startIp" TEXT,
ADD COLUMN "lastIp" TEXT,
ADD COLUMN "userAgent" TEXT;

ALTER TABLE "ProctorEvent" ADD COLUMN "ip" TEXT,
ADD COLUMN "deviceId" TEXT;

CREATE INDEX "Attempt_examId_deviceId_idx" ON "Attempt"("examId", "deviceId");

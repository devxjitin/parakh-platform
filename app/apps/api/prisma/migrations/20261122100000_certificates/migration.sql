-- Sprint 9: certificates
-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('GENERATED', 'APPROVED', 'REJECTED', 'EMAILED');

-- CreateEnum
CREATE TYPE "CertificateKind" AS ENUM ('ACHIEVEMENT', 'PARTICIPATION');

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "certificate" JSONB;

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "serialNo" TEXT NOT NULL,
    "kind" "CertificateKind" NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'GENERATED',
    "holderName" TEXT NOT NULL,
    "examTitle" TEXT NOT NULL,
    "orgName" TEXT,
    "scorePercent" DOUBLE PRECISION NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "verifyHash" TEXT NOT NULL,
    "pdfKey" TEXT,
    "pdfError" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "emailedAt" TIMESTAMP(3),
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailNextAt" TIMESTAMP(3),
    "emailError" TEXT,
    "emailMessageId" TEXT,
    "emailBouncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" UUID NOT NULL,
    "snsId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_attemptId_key" ON "Certificate"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_serialNo_key" ON "Certificate"("serialNo");

-- CreateIndex
CREATE INDEX "Certificate_examId_status_idx" ON "Certificate"("examId", "status");

-- CreateIndex
CREATE INDEX "Certificate_studentId_idx" ON "Certificate"("studentId");

-- CreateIndex
CREATE INDEX "Certificate_status_emailNextAt_idx" ON "Certificate"("status", "emailNextAt");

-- CreateIndex
CREATE INDEX "Certificate_emailMessageId_idx" ON "Certificate"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_snsId_key" ON "EmailEvent"("snsId");

-- CreateIndex
CREATE INDEX "EmailEvent_messageId_idx" ON "EmailEvent"("messageId");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


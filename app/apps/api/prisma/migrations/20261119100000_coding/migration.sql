-- CreateEnum
CREATE TYPE "CodeJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'ERROR');

-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "language" TEXT,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "runs" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "coding" JSONB;

-- CreateTable
CREATE TABLE "CodeSubmission" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "CodeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "passedWeight" DOUBLE PRECISION,
    "totalWeight" DOUBLE PRECISION,
    "results" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CodeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeSubmission_status_createdAt_idx" ON "CodeSubmission"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodeSubmission_attemptId_questionId_key" ON "CodeSubmission"("attemptId", "questionId");

-- AddForeignKey
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;


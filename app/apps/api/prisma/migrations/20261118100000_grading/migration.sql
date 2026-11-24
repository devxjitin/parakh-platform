-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "marksAwarded" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "maxScore" DOUBLE PRECISION,
ADD COLUMN     "passed" BOOLEAN,
ADD COLUMN     "percent" DOUBLE PRECISION,
ADD COLUMN     "score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "resultsPublishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "partialCredit" BOOLEAN NOT NULL DEFAULT false;


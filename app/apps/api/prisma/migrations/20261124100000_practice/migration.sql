-- Practice sets: access record and finished rounds. Separate from official attempts.
CREATE TABLE "PracticeAccess" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticeRound" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "answered" INTEGER NOT NULL,
    "scoredCount" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeAccess_studentId_examId_key" ON "PracticeAccess"("studentId", "examId");
CREATE INDEX "PracticeRound_studentId_examId_createdAt_idx" ON "PracticeRound"("studentId", "examId", "createdAt");

ALTER TABLE "PracticeAccess" ADD CONSTRAINT "PracticeAccess_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeAccess" ADD CONSTRAINT "PracticeAccess_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeRound" ADD CONSTRAINT "PracticeRound_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeRound" ADD CONSTRAINT "PracticeRound_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

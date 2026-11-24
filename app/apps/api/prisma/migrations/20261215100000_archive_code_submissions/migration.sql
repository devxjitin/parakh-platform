-- Archive coding submissions outside Prisma's public schema before removing the live table.
BEGIN;
CREATE SCHEMA IF NOT EXISTS "archive";

LOCK TABLE "CodeSubmission" IN ACCESS EXCLUSIVE MODE;

-- Store status as text so the retired enum can also be removed from the live schema.
CREATE TABLE "archive"."CodeSubmission" AS
SELECT "id", "attemptId", "questionId", "language", "source", "status"::text AS "status",
       "tries", "lockedAt", "passedWeight", "totalWeight", "results", "error", "createdAt", "finishedAt"
FROM "CodeSubmission";

DROP TABLE "CodeSubmission";
DROP TYPE "CodeJobStatus";
COMMIT;

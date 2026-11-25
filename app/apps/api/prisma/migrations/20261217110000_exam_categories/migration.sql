-- Admin-managed list of fields an always-open exam can be filed under.
CREATE TABLE "ExamCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExamCategory_name_key" ON "ExamCategory"("name");
-- Keep any category already typed on an exam, so nothing already listed loses its field.
INSERT INTO "ExamCategory" ("id", "name")
SELECT gen_random_uuid(), "catalogCategory" FROM "Exam"
WHERE "catalogCategory" <> '' GROUP BY "catalogCategory";

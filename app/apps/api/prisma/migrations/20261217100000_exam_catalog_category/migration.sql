-- The field (category) an always-open exam is filed under on the public "Available exams" list.
ALTER TABLE "Exam" ADD COLUMN "catalogCategory" TEXT NOT NULL DEFAULT '';

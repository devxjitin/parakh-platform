-- Every student now gets the same paper, and exams have no student limit.
ALTER TABLE "Exam" DROP COLUMN "questionsPerStudent", DROP COLUMN "maxStudents";

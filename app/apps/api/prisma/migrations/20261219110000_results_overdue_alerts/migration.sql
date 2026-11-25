-- Remember which exams already triggered the "results are overdue" emails, so each goes out once.
ALTER TABLE "Exam" ADD COLUMN "resultsReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN "resultsEscalatedAt" TIMESTAMP(3);

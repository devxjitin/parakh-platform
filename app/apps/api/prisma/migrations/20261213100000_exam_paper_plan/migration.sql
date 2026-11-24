-- The trainer plans the paper (total questions, and how many MCQ single, MCQ multiple and subjective, each with its marks) in the New exam workflow.
ALTER TABLE "Exam" ADD COLUMN "paperPlan" JSONB;

/** The public "Available exams" list. Metadata only: never questions, options or answers. */
export interface CatalogExamDto {
  code: string;
  title: string;
  summary: string | null;
  topics: string[];
  /** The field the exam belongs to (empty = Other). */
  category: string;
  questionCount: number;
  totalMarks: number;
  durationMinutes: number;
  passPercent: number;
  /** 0 means free. */
  feePaise: number;
  /** The result comes by email after a person has reviewed the written answers. */
  hasWrittenQuestions: boolean;
}

export interface CatalogDto {
  exams: CatalogExamDto[];
}

/** How long a student waits for a reviewed result. Shown to them and used to flag late reviews. */
export const REVIEW_PROMISE_HOURS = 24;

/** One always-open attempt waiting for an admin to mark its written answers. */
export interface ReviewQueueItemDto {
  attemptId: string;
  examId: string;
  examTitle: string;
  studentName: string;
  studentEmail: string;
  submittedAt: string;
  /** Written answers not yet marked. */
  pendingAnswers: number;
  /** Past the review promise. */
  overdue: boolean;
}

export interface ReviewQueueDto {
  items: ReviewQueueItemDto[];
}

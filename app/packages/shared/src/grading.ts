import { z } from 'zod';
import type { AttemptHistoryDto } from './accommodations';
import type { QuestionPresentation } from './exam';
import type { IntegrityDto, IntegrityFlagCode } from './integrity';

/** Rounds to 2 decimals so partial credit never leaves float noise like 1.3333333. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface GradableQuestion {
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  correctOptions: number[];
  marks: number;
  /** Multiple-answer only: give a share of the marks when some correct options were picked. */
  partialCredit: boolean;
}

export type ChoiceOutcome = 'CORRECT' | 'PARTIAL' | 'WRONG' | 'UNANSWERED';

/**
 * Marks for one choice question.
 *  - Nothing selected: 0.
 *  - Single: right option = marks, anything else = 0.
 *  - Multiple: exactly the right set = marks. With partial credit, picking only correct options
 *    (but not all) earns marks x picked / correct. Picking any wrong option, or any miss
 *    without partial credit, earns 0. There is no negative marking.
 */
export function gradeChoice(
  q: GradableQuestion,
  selected: number[],
): { marks: number; outcome: ChoiceOutcome } {
  const picked = [...new Set(selected)];
  if (picked.length === 0) return { marks: 0, outcome: 'UNANSWERED' };
  const correct = new Set(q.correctOptions);
  const hits = picked.filter((i) => correct.has(i)).length;
  const wrongPicks = picked.length - hits;

  if (wrongPicks === 0 && hits === correct.size) return { marks: q.marks, outcome: 'CORRECT' };
  if (q.type === 'MULTI' && q.partialCredit && wrongPicks === 0 && hits > 0) {
    return { marks: round2((q.marks * hits) / correct.size), outcome: 'PARTIAL' };
  }
  return { marks: 0, outcome: 'WRONG' };
}

/** Adds up awarded marks. */
export function summarize(input: { awarded: number[]; maxScore: number; passPercent: number }): {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
} {
  const score = Math.max(0, round2(input.awarded.reduce((s, m) => s + m, 0)));
  const maxScore = round2(input.maxScore);
  const percent = maxScore > 0 ? round2((score / maxScore) * 100) : 0;
  return { score, maxScore, percent, passed: percent >= input.passPercent };
}

// ------------------------------------------------------------------- manual grading

export const gradeAnswerSchema = z.object({
  marks: z.number().min(0).max(100),
  feedback: z.string().trim().max(2000).optional().nullable(),
});
export type GradeAnswerInput = z.infer<typeof gradeAnswerSchema>;

// ------------------------------------------------------------------------- DTOs

export interface ResultSummaryDto {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
}

/** One row of the trainer's results table. */
export interface AttemptRowDto {
  attemptId: string;
  studentName: string;
  studentEmail: string;
  status: string;
  endReason: string | null;
  startedAt: string;
  submittedAt: string | null;
  strikes: number;
  /** Proctor events of any kind (copy, paste, tab switches, ...). */
  violations: number;
  /** Subjective answers still waiting for marks. */
  pendingGrading: number;
  /** Integrity signals worth a look (shared device, blocked second device, ...). */
  flags: IntegrityFlagCode[];
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  passed: boolean | null;
}

export interface ExamResultsDto {
  exam: {
    id: string;
    title: string;
    status: string;
    passPercent: number;
    totalMarks: number;
    enrolled: number;
  };
  stats: {
    attempts: number;
    submitted: number;
    inProgress: number;
    pendingGrading: number;
    average: number | null;
    highest: number | null;
    passRate: number | null;
  };
  finalized: boolean;
  rows: AttemptRowDto[];
}

export interface GradingQuestionDto extends QuestionPresentation {
  questionId: string;
  number: number;
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  body: string;
  options: string[];
  correctOptions: number[];
  marks: number;
  explanation: string | null;
  rubric: string | null;
  selected: number[];
  /** Written answer. */
  text: string | null;
  marksAwarded: number | null;
  feedback: string | null;
  /** The question was dropped: everyone has its full marks. */
  dropped: boolean;
  /** The trainer set this mark by hand, with the reason. */
  override: { marks: number; reason: string } | null;
}

export interface GradingAttemptDto {
  attemptId: string;
  examId: string;
  studentName: string;
  studentEmail: string;
  status: string;
  endReason: string | null;
  strikes: number;
  events: { type: string; strike: boolean; at: string; ip: string | null }[];
  /** Time added, reopenings and device releases, oldest first. */
  history: AttemptHistoryDto[];
  integrity: IntegrityDto;
  finalized: boolean;
  result: ResultSummaryDto | null;
  questions: GradingQuestionDto[];
}

/** What a student sees once the trainer has published results. */
export interface StudentResultDto extends ResultSummaryDto {
  attemptId: string;
  examTitle: string;
  passPercent: number;
  questions: (QuestionPresentation & {
    questionId: string;
    number: number;
    type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
    body: string;
    options: string[];
    correctOptions: number[];
    selected: number[];
    text: string | null;
    marks: number;
    marksAwarded: number;
    explanation: string | null;
    feedback: string | null;
    /** The trainer dropped this question, so everyone got full marks. */
    dropped: boolean;
  })[];
}

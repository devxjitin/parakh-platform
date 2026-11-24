import { z } from 'zod';
import type { QuestionPresentation } from './exam';

/** Practice never touches official scores; it has its own limits. */
export const PRACTICE = {
  /** Attempts kept per student and exam; older ones are dropped from the history list. */
  HISTORY_LIMIT: 50,
  /** A practice set stays open this many days after the exam closes. */
  EXPIRY_DAYS: 90,
  /** Signing in with a practice code lasts this long, not the usual 30 days. */
  SESSION_HOURS: 12,
} as const;

/** One question, asking for instant feedback. Send the answer that matches the question type. */
export const practiceCheckSchema = z.object({
  selected: z.array(z.number().int().min(0).max(5)).max(6).optional(),
  text: z.string().max(50_000).optional(),
});
export type PracticeCheckInput = z.infer<typeof practiceCheckSchema>;

/** A whole practice round: the choice answers per question id. */
export const practiceSubmitSchema = z.object({
  answers: z.record(z.string().uuid(), z.array(z.number().int().min(0).max(5)).max(6)),
});
export type PracticeSubmitInput = z.infer<typeof practiceSubmitSchema>;

/** The practice code a student got by email after the exam closed (e.g. PRC-7K3P9Q). */
export const practiceRedeemSchema = z.object({
  code: z.string().trim().min(6).max(20),
});
export type PracticeRedeemInput = z.infer<typeof practiceRedeemSchema>;

// ------------------------------------------------------------------------- DTOs

export interface PracticeSummaryDto {
  examId: string;
  title: string;
  trainerName: string;
  questionCount: number;
  /** Choice questions are scored; the rest give feedback only. */
  scoredCount: number;
  rounds: number;
  bestPercent: number | null;
  lastRoundAt: string | null;
  /** The last day the set can be opened. */
  expiresAt: string;
}

export interface PracticeQuestionDto extends QuestionPresentation {
  id: string;
  number: number;
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  body: string;
  marks: number;
  options: string[];
}

export interface PracticeSetDto {
  examId: string;
  title: string;
  expiresAt: string;
  questions: PracticeQuestionDto[];
}

export interface PracticeFeedbackDto {
  questionId: string;
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  /** Null for written answers, which cannot be marked automatically. */
  correct: boolean | null;
  marks: number | null;
  maxMarks: number;
  correctOptions: number[];
  explanation: string | null;
  /** Written answers: what a good answer covers. */
  guidance: string | null;
}

export interface PracticeRoundDto {
  id: string;
  score: number;
  maxScore: number;
  percent: number;
  answered: number;
  scoredCount: number;
  createdAt: string;
  /** Per scored question, how this round went. */
  results: { questionId: string; number: number; outcome: string; marks: number }[];
}

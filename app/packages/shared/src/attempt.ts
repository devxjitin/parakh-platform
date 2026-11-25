import { z } from 'zod';
import type { QuestionPresentation } from './exam';

export const startAttemptSchema = z.object({ enrollmentId: z.string().uuid() });
export type StartAttemptInput = z.infer<typeof startAttemptSchema>;

/** Autosave payload. Send only what changed; at least one field is required. */
export const saveAnswerSchema = z
  .object({
    selected: z.array(z.number().int().min(0).max(5)).max(6).optional(),
    text: z.string().max(50_000).optional(),
    flagged: z.boolean().optional(),
    /** Client counter that only goes up; the server ignores a write older than what it holds. */
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .refine((v) => v.selected !== undefined || v.text !== undefined || v.flagged !== undefined, {
    message: 'Nothing to save',
  });
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;

/** Browser-side signals the student's exam page reports. */
export const PROCTOR_EVENTS = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'COPY',
  'PASTE',
  'CONTEXT_MENU',
  'DEVTOOLS_KEY',
  /** Info only: this browser cannot go full screen (iOS Safari), so it is not held against the student. */
  'FULLSCREEN_UNSUPPORTED',
] as const;
export type ProctorEventType = (typeof PROCTOR_EVENTS)[number];

/** Events that cost a strike. The rest are logged for the trainer only. */
export const STRIKE_EVENTS: readonly ProctorEventType[] = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
];

export const proctorEventSchema = z.object({ type: z.enum(PROCTOR_EVENTS) });
export type ProctorEventInput = z.infer<typeof proctorEventSchema>;

/** Events that could not be sent while offline, sent together later. */
export const proctorEventBatchSchema = z.object({
  events: z.array(proctorEventSchema).min(1).max(50),
});
export type ProctorEventBatchInput = z.infer<typeof proctorEventBatchSchema>;

export type JoinState = 'OPEN' | 'NOT_STARTED' | 'ENDED' | 'ALREADY_ENROLLED';

export interface JoinInfoDto {
  examId: string;
  code: string;
  title: string;
  description: string | null;
  trainerName: string;
  orgName: string | null;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  questionCount: number;
  totalMarks: number;
  /** 0 means the exam is free: no payment step. */
  feePaise: number;
  /** Run by NandiVex itself (no trainer). */
  nandivexHosted: boolean;
  /** The trainer paid for a fixed list of students: only those emails can join, and nobody pays. */
  sponsored: boolean;
  /** Open any time after payment: there are no start and end times. */
  alwaysOpen: boolean;
  /** Has written answers, so the result comes by email after a person has reviewed them. */
  hasWrittenQuestions: boolean;
  state: JoinState;
}

export interface EnrollmentDto {
  enrollmentId: string;
  exam: {
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    durationMinutes: number;
  };
  attempt: { id: string; status: string; deadlineAt: string } | null;
  /** Set once the trainer has published results. */
  result: { score: number; maxScore: number; percent: number; passed: boolean } | null;
  /** The exam window is open and no attempt has ended yet. */
  canStart: boolean;
  /** An always-open exam whose result has been emailed: the student can take it again (and pay again). */
  canRetake: boolean;
}

export interface AttemptQuestionDto extends QuestionPresentation {
  id: string;
  number: number;
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  body: string;
  marks: number;
  /** Options in this student's order. `id` is the original index and is what gets saved. */
  options: { id: number; text: string }[];
}

export interface AttemptAnswerDto {
  selected: number[];
  text: string;
  flagged: boolean;
}

export interface AttemptTimingDto {
  status: string;
  endReason: string | null;
  /** Server clock, so the browser can show an accurate countdown. */
  serverTime: string;
  deadlineAt: string;
}

export interface AttemptDto extends AttemptTimingDto {
  id: string;
  strikes: number;
  maxStrikes: number;
  strikePolicy: 'OFF' | 'WARN' | 'AUTO_SUBMIT';
  exam: {
    title: string;
    instructions: string | null;
    durationMinutes: number;
    /** Share code, shown on the start screen. */
    code: string | null;
    trainerName: string;
    orgName: string | null;
    questionCount: number;
    totalMarks: number;
    passPercent: number;
    endsAt: string | null;
  };
  /** Who is taking the exam. */
  student: { name: string; email: string };
  /** Empty once the attempt has ended. */
  questions: AttemptQuestionDto[];
  answers: Record<string, AttemptAnswerDto>;
}

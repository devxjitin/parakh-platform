import { z } from 'zod';
import { LIMITS } from './constants';

/** Settings a trainer controls on a draft exam. */
const examSettings = {
  title: z
    .string({ message: 'Enter an exam title' })
    .trim()
    .min(3, 'The title needs at least 3 characters')
    .max(150, 'The title can be at most 150 characters'),
  description: z
    .string()
    .trim()
    .max(2000, 'Keep the description under 2000 characters')
    .optional()
    .nullable(),
  instructions: z
    .string()
    .trim()
    .max(4000, 'Keep the instructions under 4000 characters')
    .optional()
    .nullable(),
  durationMinutes: z
    .number({ message: 'Enter the duration in minutes' })
    .int('Duration must be a whole number of minutes')
    .min(5, 'Duration must be at least 5 minutes')
    .max(
      LIMITS.MAX_EXAM_DURATION_MINUTES,
      `Duration can be at most ${LIMITS.MAX_EXAM_DURATION_MINUTES} minutes`,
    ),
  // The exam window. Both optional while drafting; required to publish (Sprint 3).
  startsAt: z
    .string()
    .datetime({ message: 'Enter a valid opening date and time' })
    .optional()
    .nullable(),
  endsAt: z
    .string()
    .datetime({ message: 'Enter a valid closing date and time' })
    .optional()
    .nullable(),
  passPercent: z
    .number({ message: 'Enter a pass mark between 0 and 100' })
    .min(0, 'Pass mark cannot be below 0%')
    .max(100, 'Pass mark cannot be above 100%'),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  strikePolicy: z.enum(['OFF', 'WARN', 'AUTO_SUBMIT']),
  maxStrikes: z.number().int().min(1, 'At least 1').max(10, 'At most 10'),
};

/**
 * What a student pays to join, in paise. Only NandiVex-run exams use it (admin-created); 0 makes
 * the exam free, otherwise the gateway minimum applies. Ignored for trainer exams.
 */
export const studentFeeSchema = z
  .number({ message: 'Enter the student fee' })
  .int('Fee must be a whole number of paise')
  .max(10_000_00, 'Fee can be at most ₹10,000')
  .refine((v) => v === 0 || v >= 100, 'Fee must be 0 (free) or at least ₹1');

/**
 * Admin-only fields: an always-open exam and how it appears on the public "Available exams" list.
 * Every always-open exam is listed once published (retiring it takes it off), so there is no
 * switch for that; the summary and topics are required for it.
 */
const catalogFields = {
  alwaysOpen: z.boolean(),
  catalogSummary: z
    .string()
    .trim()
    .max(300, 'Keep the summary under 300 characters')
    .optional()
    .nullable(),
  catalogCategory: z.string().trim().max(40, 'At most 40 characters').optional(),
  catalogTopics: z
    .array(z.string().trim().min(1, 'A topic cannot be empty').max(40, 'At most 40 characters'))
    .max(12, 'At most 12 topics'),
};

const windowIsValid = (v: { startsAt?: string | null; endsAt?: string | null }) =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);
const windowMessage = { message: 'The end time must be after the start time', path: ['endsAt'] };

const planCount = (what: string) =>
  z
    .number({ message: `Enter how many ${what} questions` })
    .int('Use a whole number')
    .min(0, 'Cannot be negative')
    .max(LIMITS.MAX_QUESTIONS_PER_EXAM, `At most ${LIMITS.MAX_QUESTIONS_PER_EXAM} questions`);

const planMarks = (what: string) =>
  z
    .number({ message: `Enter the marks for each ${what} question` })
    .min(0, 'Marks cannot be negative')
    .max(100, 'At most 100 marks per question');

/** The three kinds of question an exam can have, as the trainer sees them. */
export const QUESTION_TYPE_LABELS = {
  SINGLE: 'MCQ (Single)',
  MULTI: 'MCQ (Multiple)',
  SUBJECTIVE: 'Subjective',
} as const;

/**
 * The trainer's plan for the paper, set in the New exam workflow: the total number of questions,
 * and for each of the three kinds (MCQ single, MCQ multiple, subjective) how many there are and
 * how many marks each one is worth. The counts must add up to the total.
 */
export const paperPlanSchema = z
  .object({
    totalQuestions: z
      .number({ message: 'Enter how many questions the exam has' })
      .int('Use a whole number of questions')
      .min(1, 'The exam needs at least 1 question')
      .max(LIMITS.MAX_QUESTIONS_PER_EXAM, `At most ${LIMITS.MAX_QUESTIONS_PER_EXAM} questions`),
    singleCount: planCount('MCQ (Single)'),
    multiCount: planCount('MCQ (Multiple)'),
    subjectiveCount: planCount('subjective'),
    /** Marks each question of that kind is worth (needed when there are questions of that kind). */
    singleMarks: planMarks('MCQ (Single)'),
    multiMarks: planMarks('MCQ (Multiple)'),
    subjectiveMarks: planMarks('subjective'),
  })
  .refine((p) => p.singleCount + p.multiCount + p.subjectiveCount === p.totalQuestions, {
    message: 'The three question types must add up to the total number of questions',
    path: ['subjectiveCount'],
  })
  .refine((p) => p.singleCount === 0 || p.singleMarks > 0, {
    message: 'Enter the marks for each MCQ (Single)',
    path: ['singleMarks'],
  })
  .refine((p) => p.multiCount === 0 || p.multiMarks > 0, {
    message: 'Enter the marks for each MCQ (Multiple)',
    path: ['multiMarks'],
  })
  .refine((p) => p.subjectiveCount === 0 || p.subjectiveMarks > 0, {
    message: 'Enter the marks for each subjective question',
    path: ['subjectiveMarks'],
  });

interface PlanNumbers {
  singleCount: number;
  multiCount: number;
  subjectiveCount: number;
  singleMarks: number;
  multiMarks: number;
  subjectiveMarks: number;
}

/** The total marks a plan adds up to: each kind of question at its own marks. */
export const planTotalMarks = (p: PlanNumbers): number =>
  Math.round(
    (p.singleCount * p.singleMarks +
      p.multiCount * p.multiMarks +
      p.subjectiveCount * p.subjectiveMarks) *
      100,
  ) / 100;

/** The marks the plan gives to one question of this kind. */
export const planMarksFor = (
  p: Pick<PlanNumbers, 'singleMarks' | 'multiMarks' | 'subjectiveMarks'>,
  type: keyof typeof QUESTION_TYPE_LABELS,
): number =>
  type === 'SINGLE' ? p.singleMarks : type === 'MULTI' ? p.multiMarks : p.subjectiveMarks;
export type PaperPlan = z.infer<typeof paperPlanSchema>;

export const createExamSchema = z
  .object({
    ...examSettings,
    description: examSettings.description,
    durationMinutes: examSettings.durationMinutes.default(60),
    passPercent: examSettings.passPercent.default(40),
    shuffleQuestions: examSettings.shuffleQuestions.default(true),
    shuffleOptions: examSettings.shuffleOptions.default(true),
    strikePolicy: examSettings.strikePolicy.default('AUTO_SUBMIT'),
    maxStrikes: examSettings.maxStrikes.default(3),
    /** Kept for older clients. New exams start with certificates on; the trainer switches them in the Certificate tab. */
    certificatesEnabled: z.boolean().default(true),
    /** The paper the trainer plans in the New exam workflow: how many questions of each kind and their marks. */
    paperPlan: paperPlanSchema.optional(),
    /** NandiVex-run exams only (ignored for trainers). */
    studentFeePaise: studentFeeSchema.optional(),
    /** NandiVex-run exams only (ignored for trainers). */
    alwaysOpen: catalogFields.alwaysOpen.optional(),
    catalogSummary: catalogFields.catalogSummary,
    catalogTopics: catalogFields.catalogTopics.optional(),
    catalogCategory: catalogFields.catalogCategory,
  })
  .refine(windowIsValid, windowMessage)
  .refine((v) => !v.alwaysOpen || Boolean(v.catalogSummary?.trim()), {
    message: 'Write a short summary students will see in the exam list',
    path: ['catalogSummary'],
  })
  .refine((v) => !v.alwaysOpen || (v.catalogTopics?.length ?? 0) > 0, {
    message: 'Add at least one topic',
    path: ['catalogTopics'],
  })
  .refine((v) => !v.alwaysOpen || Boolean(v.catalogCategory?.trim()), {
    message: 'Choose the category this exam belongs to',
    path: ['catalogCategory'],
  });
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = z
  .object({
    ...examSettings,
    ...catalogFields,
    studentFeePaise: studentFeeSchema,
    paperPlan: paperPlanSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(windowIsValid, windowMessage);
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

// ---------------------------------------------------------------- questions

const marks = z.number().min(0).max(100);
const optionText = z.string().trim().min(1).max(1000);

const questionBase = {
  body: z.string().trim().min(1).max(5000),
  markdown: z.boolean().optional(),
  imageAlt: z.string().trim().min(1).max(300).nullish(),
  marks: marks.default(4),
  explanation: z.string().trim().max(3000).optional().nullable(),
};

const choiceQuestion = {
  ...questionBase,
  // Multiple-answer only: share the marks when some (but not all) correct options are picked and
  // none wrong. On by default; the trainer is not asked.
  partialCredit: z.boolean().default(true),
  options: z.array(optionText).min(2).max(6),
  correctOptions: z.array(z.number().int().min(0).max(5)).min(1),
};

function checkChoice(
  v: { type: string; options: string[]; correctOptions: number[] },
  ctx: z.RefinementCtx,
) {
  const unique = new Set(v.correctOptions);
  if (unique.size !== v.correctOptions.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctOptions'],
      message: 'Duplicate correct options',
    });
  }
  if (v.correctOptions.some((i) => i >= v.options.length)) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctOptions'],
      message: 'A correct option does not exist',
    });
  }
  if (v.type === 'SINGLE' && v.correctOptions.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctOptions'],
      message: 'A single-answer question needs exactly one correct option',
    });
  }
  if (v.type === 'MULTI' && v.correctOptions.length < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctOptions'],
      message: 'A multiple-answer question needs at least two correct options',
    });
  }
}

export const questionInputSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('SINGLE'), ...choiceQuestion }),
    z.object({ type: z.literal('MULTI'), ...choiceQuestion }),
    z.object({
      type: z.literal('SUBJECTIVE'),
      ...questionBase,
      // Guidance for whoever marks the answer.
      rubric: z.string().trim().max(3000).optional().nullable(),
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.type === 'SINGLE' || v.type === 'MULTI') checkChoice(v, ctx);
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const reorderQuestionsSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(LIMITS.MAX_QUESTIONS_PER_EXAM),
});
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;

export const importQuestionsSchema = z.object({
  text: z.string().min(1).max(500_000),
  defaultMarks: marks.default(4),
  // false = just parse and show what would be imported.
  commit: z.boolean().default(false),
});
export type ImportQuestionsInput = z.infer<typeof importQuestionsSchema>;

// ---------------------------------------------------------------- responses

export interface QuestionPresentation {
  markdown: boolean;
  /** Present when a private image is attached. */
  imageAlt: string | null;
}

export interface ExamQuestionDto extends QuestionPresentation {
  id: string;
  position: number;
  type: 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
  body: string;
  options: string[];
  correctOptions: number[];
  marks: number;
  partialCredit: boolean;
  explanation: string | null;
  rubric: string | null;
}

export interface ExamSummaryDto {
  id: string;
  title: string;
  status: string;
  /** Always open (NandiVex-run): no window, one attempt per payment. Fixed when the exam is created. */
  alwaysOpen: boolean;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  questionCount: number;
  totalMarks: number;
  /** Students who joined this exam (set on the trainer's exam list). */
  joinedCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamDetailDto extends ExamSummaryDto {
  description: string | null;
  instructions: string | null;
  passPercent: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  strikePolicy: 'OFF' | 'WARN' | 'AUTO_SUBMIT';
  maxStrikes: number;
  certificatesEnabled: boolean;
  hasLogo: boolean;
  /** Run by NandiVex (created by an admin): no trainer, no creation fee. */
  nandivexHosted: boolean;
  /** Trainer-pays mode: how many students' seats the trainer bought (0 = students pay). */
  sponsoredCount: number;
  /** What students pay (NandiVex-run exams); null means the standard platform fee. */
  studentFeePaise: number | null;
  listedPublicly: boolean;
  catalogSummary: string | null;
  catalogTopics: string[];
  /** The field the exam is filed under on the public list (empty = Other). */
  catalogCategory: string;
  /** Share code; set once the creation fee is paid. */
  code: string | null;
  publishedAt: string | null;
  /** The AI paper brief last used on this draft (checked with aiBriefSchema before use). */
  aiBrief: Record<string, unknown> | null;
  /** The question counts planned when the exam was created: total, count and marks per question type (null for older exams). */
  paperPlan: PaperPlan | null;
  questions: ExamQuestionDto[];
}

/** What a student sees: no correct answers, no explanations, no rubric. */
export type PreviewQuestionDto = Omit<ExamQuestionDto, 'correctOptions' | 'explanation' | 'rubric'>;

export interface ExamPreviewDto {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  durationMinutes: number;
  totalMarks: number;
  passPercent: number;
  questions: PreviewQuestionDto[];
}
export const RESULT_RELEASE_DELAY_MIN = 30;

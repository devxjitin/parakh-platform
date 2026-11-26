import { type ExamDetailDto, type ExamQuestionDto } from '@parakh/shared';
import { PAPER_STEPS } from '../exam-stepper';
import { parseStudentEmails, type PayerChoice } from '../payment-step';

/** How many questions of each type the exam has so far. */
export function addedByType(exam: ExamDetailDto) {
  const count = (t: ExamQuestionDto['type']) => exam.questions.filter((q) => q.type === t).length;
  return { SINGLE: count('SINGLE'), MULTI: count('MULTI'), SUBJECTIVE: count('SUBJECTIVE') };
}

/** How many questions of this type the plan asks for. */
export const planCountFor = (
  p: { singleCount: number; multiCount: number; subjectiveCount: number },
  t: ExamQuestionDto['type'],
) => (t === 'SINGLE' ? p.singleCount : t === 'MULTI' ? p.multiCount : p.subjectiveCount);

/** The steps this exam goes through (a NandiVex-run exam has no trainer logo and no creation fee). */
export function stepsFor(exam: ExamDetailDto) {
  return exam.nandivexHosted
    ? PAPER_STEPS.filter((s) => s.key !== 'logo' && s.key !== 'payment')
    : PAPER_STEPS;
}

/**
 * What is still missing before a step counts as complete (null = complete). A step can only be
 * opened once every step before it is complete.
 *  - Basics, Plan and Certificate are saved by Next; Logo is optional and always has a valid value (the logo is
 *    optional; the certificate starts from the default design).
 *  - Plan needs a valid plan and a start time.
 *  - Questions needs every planned question added, per type.
 *  - Payment needs at least one valid email when the trainer buys the seats.
 */
export function stepProblem(exam: ExamDetailDto, key: string, payer: PayerChoice): string | null {
  const plan = exam.paperPlan;
  switch (key) {
    case 'plan':
      return plan && (exam.alwaysOpen || exam.startsAt)
        ? null
        : 'Complete the paper plan (total questions, types and marks) and choose the start time.';
    case 'questions': {
      if (!plan) return 'Complete the paper plan first.';
      const added = addedByType(exam);
      const open = (['SINGLE', 'MULTI', 'SUBJECTIVE'] as const).some(
        (k) => added[k] !== planCountFor(plan, k),
      );
      return open
        ? `Add all ${plan.totalQuestions} planned questions to continue, or change the paper plan.`
        : null;
    }
    case 'payment': {
      if (payer.mode !== 'TRAINER') return null;
      const { emails, bad } = parseStudentEmails(payer.emailText);
      if (emails.length === 0)
        return 'Add at least one student email, or let students pay themselves.';
      if (bad.length) return `Fix these email addresses: ${bad.join(', ')}`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * What stops the Next button. The basics and plan steps are saved by Next itself, so they never
 * block it here: pressing it checks and saves the form and shows what is wrong.
 */
export function gateProblem(exam: ExamDetailDto, key: string, payer: PayerChoice): string | null {
  return key === 'plan' ? null : stepProblem(exam, key, payer);
}

/** Index of the furthest step that can be opened: the first incomplete one. */
export function furthestStep(
  exam: ExamDetailDto,
  steps: { key: string }[],
  payer: PayerChoice,
): number {
  const open = steps.findIndex((s) => stepProblem(exam, s.key, payer) !== null);
  return open === -1 ? steps.length - 1 : open;
}

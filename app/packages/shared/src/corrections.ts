import { z } from 'zod';

const reason = z.string().trim().min(5).max(500);

/** Fix the wording of a published question. Options keep their number and order. */
export const correctQuestionSchema = z
  .object({
    body: z.string().trim().min(1).max(5000).optional(),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(6).optional(),
    explanation: z.string().trim().max(3000).nullable().optional(),
    rubric: z.string().trim().max(3000).nullable().optional(),
    reason: reason.optional(),
  })
  .refine(
    (v) =>
      v.body !== undefined ||
      v.options !== undefined ||
      v.explanation !== undefined ||
      v.rubric !== undefined,
    { message: 'Nothing to change' },
  );
export type CorrectQuestionInput = z.infer<typeof correctQuestionSchema>;

/** Change which options are correct. Every finished attempt is marked again. */
export const answerKeySchema = z.object({
  correctOptions: z.array(z.number().int().min(0).max(5)).min(1).max(6),
  partialCredit: z.boolean().optional(),
  reason,
});
export type AnswerKeyInput = z.infer<typeof answerKeySchema>;

export const dropQuestionSchema = z.object({ dropped: z.boolean(), reason });
export type DropQuestionInput = z.infer<typeof dropQuestionSchema>;

/** One student's choice answer gets a mark chosen by the trainer. null clears it. */
export const overrideMarksSchema = z
  .object({ marks: z.number().min(0).max(100).nullable(), reason: reason.optional() })
  .refine((v) => v.marks === null || v.reason !== undefined, {
    message: 'Say why the mark is being changed',
    path: ['reason'],
  });
export type OverrideMarksInput = z.infer<typeof overrideMarksSchema>;

export interface CorrectionResultDto {
  /** Attempts marked again because of this change. */
  regraded: number;
}

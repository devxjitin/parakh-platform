import { z } from 'zod';

const reason = z.string().trim().min(5).max(500);

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

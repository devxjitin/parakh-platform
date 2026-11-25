import { z } from 'zod';

/** What an exam is doing right now. Only part of this is stored; the rest follows from the window. */
export type ExamPhase = 'DRAFT' | 'UPCOMING' | 'LIVE' | 'CLOSED' | 'RESULTS' | 'CANCELLED';

export function examPhase(
  exam: { status: string; startsAt: Date | string | null; endsAt: Date | string | null },
  now: Date = new Date(),
): ExamPhase {
  if (exam.status === 'DRAFT') return 'DRAFT';
  if (exam.status === 'CANCELLED') return 'CANCELLED';
  if (exam.status === 'RESULTS_FINAL') return 'RESULTS';
  const t = now.getTime();
  if (exam.endsAt && new Date(exam.endsAt).getTime() <= t) return 'CLOSED';
  if (exam.startsAt && new Date(exam.startsAt).getTime() > t) return 'UPCOMING';
  return 'LIVE';
}

export const cancelExamSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  /** Cancel even though some students already started. */
  force: z.boolean().optional(),
});
export type CancelExamInput = z.infer<typeof cancelExamSchema>;

export const rescheduleExamSchema = z.object({
  startsAt: z.string().datetime({ message: 'Enter a valid opening date and time' }),
  /** Leave out to close when the exam time is up (start plus duration). */
  endsAt: z.string().datetime({ message: 'Enter a valid closing date and time' }).nullish(),
});
export type RescheduleExamInput = z.infer<typeof rescheduleExamSchema>;

export interface RescheduleExamResultDto {
  startsAt: string;
  endsAt: string;
  /** Students who had joined and were emailed the new time. */
  notified: number;
}

export interface CancelExamResultDto {
  status: 'CANCELLED';
  /** Students who had a seat. */
  students: number;
  /** Students who had paid and not started: their fee is being refunded automatically. */
  refunding: number;
}

export interface CloseExamResultDto {
  closedAt: string;
  /** Students still sitting the exam; they keep their own deadline. */
  stillRunning: number;
}

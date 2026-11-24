import { z } from 'zod';

const reason = z.string().trim().min(5).max(500);

/** Extra time for one student, set before they start. */
export const extraMinutesSchema = z.object({ minutes: z.number().int().min(0).max(240) });
export type ExtraMinutesInput = z.infer<typeof extraMinutesSchema>;

/** More time for a student who is sitting the exam right now. */
export const addTimeSchema = z.object({
  minutes: z.number().int().min(1).max(120),
  reason,
});
export type AddTimeInput = z.infer<typeof addTimeSchema>;

/** Puts a submitted attempt back in progress, for example after a power cut or accidental strikes. */
export const reopenAttemptSchema = z.object({
  minutes: z.number().int().min(1).max(240),
  reason,
  resetStrikes: z.boolean().optional(),
});
export type ReopenAttemptInput = z.infer<typeof reopenAttemptSchema>;

/** A change a trainer or the system made to one attempt, shown on the marking screen. */
export interface AttemptHistoryDto {
  action: 'ADD_TIME' | 'REOPEN' | 'DEVICE_RELEASED' | 'DEVICE_AUTO_RELEASED';
  at: string;
  reason: string | null;
  minutes: number | null;
}

/** One enrolled student, for setting extra time before they start. */
export interface RosterRowDto {
  enrollmentId: string;
  name: string;
  email: string;
  extraMinutes: number;
  started: boolean;
}

/** A device that has been silent this long may be replaced without the trainer. */
export const DEVICE_SILENT_MS = 5 * 60_000;

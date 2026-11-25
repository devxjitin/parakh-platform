import type { JoinState } from '@parakh/shared';

/** Whether a student can join right now. Pure so the same rule is used when ordering and capturing. */
export function computeJoinState(input: {
  startsAt: Date | null;
  endsAt: Date | null;
  alreadyEnrolled: boolean;
  now?: Date;
}): JoinState {
  const now = input.now ?? new Date();
  if (input.alreadyEnrolled) return 'ALREADY_ENROLLED';
  if (input.endsAt && input.endsAt <= now) return 'ENDED';
  // Joining stays open until the exam closes; starting is what the window gates.
  return input.startsAt && input.startsAt > now ? 'NOT_STARTED' : 'OPEN';
}

/** Codes are typed by hand: ignore case, spaces and a missing dash. */
export function normalizeCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.startsWith('NVX') ? `NVX-${c.slice(3)}` : c;
}

/**
 * What a student pays to join. NandiVex-run exams carry their own fee (0 = free); trainer exams
 * always use the platform fee from the admin settings.
 */
export function examJoinFee(
  exam: { nandivexHosted: boolean; studentFeePaise: number | null },
  platformJoinPaise: number,
): number {
  return exam.nandivexHosted && exam.studentFeePaise !== null
    ? exam.studentFeePaise
    : platformJoinPaise;
}

/**
 * An always-open exam can be taken again once the student's result has been emailed. Until then
 * (still being marked, or still running) the seat stays as it is.
 */
export function canRetake(seat: {
  exam: { alwaysOpen: boolean };
  attempt: { status: string; resultEmailedAt: Date | null } | null;
}): boolean {
  return (
    seat.exam.alwaysOpen &&
    seat.attempt !== null &&
    seat.attempt.status !== 'IN_PROGRESS' &&
    seat.attempt.resultEmailedAt !== null
  );
}

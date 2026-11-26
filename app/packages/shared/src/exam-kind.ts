/**
 * What kind of exam this is, in one place. An exam has four raw flags (`alwaysOpen`,
 * `nandivexHosted`, `studentFeePaise`, `sponsoredEmails`); every service used to combine them its
 * own way. Use these instead of testing the flags directly.
 */

export interface ExamKindInput {
  alwaysOpen: boolean;
  nandivexHosted: boolean;
  /** Only NandiVex-run exams carry their own fee (0 = free); null means the platform fee. */
  studentFeePaise: number | null;
  /** Emails the trainer has paid for. Any entry means the trainer pays, not the student. */
  sponsoredEmails: readonly string[];
}

/** Who pays, and how much, when a student joins. */
export type PricingMode =
  /** The trainer paid for invited emails; students pay nothing. */
  | 'TRAINER_SPONSORED'
  /** A NandiVex exam with its own fee of 0. */
  | 'NANDIVEX_FREE'
  /** A NandiVex exam with its own fee above 0. */
  | 'NANDIVEX_PAID'
  /** The student pays the platform fee from admin settings (every trainer exam). */
  | 'TRAINER_STUDENT_PAYS';

export type ExamKind = PricingMode | 'ALWAYS_OPEN';

type PricingInput = Pick<ExamKindInput, 'nandivexHosted' | 'studentFeePaise' | 'sponsoredEmails'>;

export function pricingMode(exam: PricingInput): PricingMode {
  if (exam.sponsoredEmails.length > 0) return 'TRAINER_SPONSORED';
  if (exam.nandivexHosted && exam.studentFeePaise !== null) {
    return exam.studentFeePaise === 0 ? 'NANDIVEX_FREE' : 'NANDIVEX_PAID';
  }
  return 'TRAINER_STUDENT_PAYS';
}

/** An always-open exam is its own kind; every other exam is described by who pays. */
export function examKind(exam: ExamKindInput): ExamKind {
  return exam.alwaysOpen ? 'ALWAYS_OPEN' : pricingMode(exam);
}

/** What a student pays to join, in paise. `platformJoinPaise` is the fee from admin settings. */
export function studentJoinFee(exam: PricingInput, platformJoinPaise: number): number {
  switch (pricingMode(exam)) {
    case 'TRAINER_SPONSORED':
    case 'NANDIVEX_FREE':
      return 0;
    case 'NANDIVEX_PAID':
      return exam.studentFeePaise as number;
    case 'TRAINER_STUDENT_PAYS':
      return platformJoinPaise;
  }
}

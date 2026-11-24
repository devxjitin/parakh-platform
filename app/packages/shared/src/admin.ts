import { z } from 'zod';

// ----------------------------------------------------------------- platform settings

const paise = (max: number, min = 0) => z.number().int().min(min).max(max);
/** Razorpay rejects orders below 100 paise (Rs 1), so a fee cannot be lower. */
export const MIN_FEE_PAISE = 100;

/** What NandiVex can change from the admin console. Applies to payments made from then on. */
export const platformSettingsSchema = z.object({
  /** Trainer pays this to publish an exam. */
  examCreationPaise: paise(10_000_00, MIN_FEE_PAISE),
  /** Student pays this to join an exam. */
  examJoinPaise: paise(10_000_00, MIN_FEE_PAISE),
  /** Trainer's share of each student-paid fee, in percent. */
  examinerSharePercent: z.number().int().min(0).max(100),
  /** Trainers can ask for a payout once this much is payable. */
  minPayoutPaise: paise(1_000_000_00),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

// ------------------------------------------------------------------------ reports

/** One month of money, from the ledger. All amounts are paise. */
export interface MonthlyReportDto {
  /** YYYY-MM */
  month: string;
  /** Money received from students and trainers. */
  grossPaise: number;
  refundedPaise: number;
  /** NandiVex's revenue after refunds (creation fees, its half of join fees, sponsored seats). */
  platformRevenuePaise: number;
  /** Trainers' share earned this month, after refunds. */
  examinerEarnedPaise: number;
  /** Payouts sent to trainers this month. */
  paidOutPaise: number;
  /** What NandiVex owed trainers at the end of the month. */
  owedAtMonthEndPaise: number;
  /** Owed right now and ready to pay (results published), across all trainers. */
  payableNowPaise: number;
  examiners: {
    examinerId: string;
    name: string;
    email: string;
    earnedPaise: number;
    paidOutPaise: number;
    owedAtMonthEndPaise: number;
  }[];
}

export interface SeriesPointDto {
  month: string;
  grossPaise: number;
  refundedPaise: number;
  platformRevenuePaise: number;
  examinerEarnedPaise: number;
  paidOutPaise: number;
}

export interface AdminOverviewDto {
  users: { students: number; examiners: number; admins: number; suspended: number };
  exams: { total: number; live: number; awaitingResults: number };
  enrollments: number;
  waiting: { payoutRequests: number; certificates: number };
  /** The ledger always adds up to zero; false means something is badly wrong. */
  ledgerBalanced: boolean;
}

export interface AdminExamRowDto {
  id: string;
  title: string;
  code: string | null;
  status: string;
  trainerName: string;
  trainerEmail: string;
  enrollments: number;
  attempts: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface AuditRowDto {
  id: string;
  action: string;
  actorName: string | null;
  entity: string | null;
  entityId: string | null;
  ip: string | null;
  meta: unknown;
  createdAt: string;
}

export interface PageDto<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

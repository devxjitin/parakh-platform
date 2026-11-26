import { z } from 'zod';
import { PRICING } from './constants';
import { splitGross } from './money';

// ----------------------------------------------------------------- ledger math

/**
 * Accounts of the double-entry ledger. Every transaction has entries that add up to zero, so
 * the whole ledger always adds up to zero. A positive balance on EXAMINER:<id> is money NandiVex
 * owes that trainer.
 */
export const ACCOUNTS = {
  /** Money entering or leaving the business (student cards, the bank). */
  EXTERNAL: 'EXTERNAL',
  /** NandiVex's own revenue. */
  PLATFORM: 'PLATFORM',
  /** Money sent out to trainers. */
  PAYOUTS: 'PAYOUTS',
  examiner: (id: string) => `EXAMINER:${id}`,
} as const;

export interface LedgerLine {
  account: string;
  amountPaise: number;
  examId?: string | null;
  note?: string;
}

/** A student's join fee: the trainer gets their share, NandiVex keeps the rest. */
export function joinFeeLines(
  grossPaise: number,
  examinerId: string,
  examId: string,
  examinerPercent: number = PRICING.EXAMINER_SHARE_PERCENT,
): LedgerLine[] {
  const { examinerPaise, platformPaise } = splitGross(grossPaise, examinerPercent);
  return [
    { account: ACCOUNTS.EXTERNAL, amountPaise: -grossPaise, examId },
    { account: ACCOUNTS.examiner(examinerId), amountPaise: examinerPaise, examId },
    { account: ACCOUNTS.PLATFORM, amountPaise: platformPaise, examId },
  ];
}

/** Everything that goes entirely to NandiVex: creation fees, sponsored seats, unseated payments. */
export function platformFeeLines(grossPaise: number, examId?: string | null, note?: string) {
  return [
    { account: ACCOUNTS.EXTERNAL, amountPaise: -grossPaise, examId, note },
    { account: ACCOUNTS.PLATFORM, amountPaise: grossPaise, examId, note },
  ] satisfies LedgerLine[];
}

/** Paying a trainer: their balance goes down, the payouts account goes up. */
export function payoutLines(amountPaise: number, examinerId: string): LedgerLine[] {
  return [
    { account: ACCOUNTS.examiner(examinerId), amountPaise: -amountPaise },
    { account: ACCOUNTS.PAYOUTS, amountPaise },
  ];
}

/** The exact opposite of earlier lines, used for refunds. */
export const reverseLines = (lines: LedgerLine[]): LedgerLine[] =>
  lines.map((l) => ({ ...l, amountPaise: -l.amountPaise }));

/** Throws unless the lines add up to zero. The ledger never accepts anything else. */
export function assertBalanced(lines: { amountPaise: number }[]): void {
  if (lines.length < 2) throw new Error('A ledger transaction needs at least two entries');
  if (lines.some((l) => !Number.isInteger(l.amountPaise))) {
    throw new Error('Ledger amounts must be whole paise');
  }
  const sum = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (sum !== 0) throw new Error(`Ledger transaction is out of balance by ${sum} paise`);
}

// ------------------------------------------------------------- payout details

const UPI = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,32}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const payoutDetailsSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('UPI'),
    upiId: z.string().trim().regex(UPI, 'Enter a valid UPI id, like name@bank'),
  }),
  z.object({
    method: z.literal('BANK'),
    accountName: z.string().trim().min(2).max(100),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
    ifsc: z.string().trim().toUpperCase().regex(IFSC, 'Enter a valid IFSC code, like HDFC0001234'),
  }),
]);
export type PayoutDetailsInput = z.infer<typeof payoutDetailsSchema>;

/** Shows a stored account number safely: only the last four digits. */
export const maskAccount = (last4: string | null) => (last4 ? `****${last4}` : null);

export interface PayoutDetailsDto {
  method: 'UPI' | 'BANK' | null;
  upiId: string | null;
  accountName: string | null;
  /** Last four digits only. */
  accountMasked: string | null;
  ifsc: string | null;
  verifiedAt: string | null;
}

// -------------------------------------------------------------------- payouts

export const payoutActions = {
  utr: z
    .string()
    .trim()
    .min(6, 'Enter the bank or UPI reference (UTR)')
    .max(40)
    .regex(/^[A-Za-z0-9\-_/]+$/, 'The reference can have letters, numbers and - _ / only'),
  note: z.string().trim().max(300).optional().nullable(),
};

export const payPayoutSchema = z.object({
  utr: payoutActions.utr,
  note: payoutActions.note,
});
export type PayPayoutInput = z.infer<typeof payPayoutSchema>;

export const directPayoutSchema = z.object({
  examinerId: z.string().uuid(),
  amountPaise: z.number().int().min(100),
  utr: payoutActions.utr,
  note: payoutActions.note,
});
export type DirectPayoutInput = z.infer<typeof directPayoutSchema>;

export const rejectPayoutSchema = z.object({ note: z.string().trim().min(3).max(300) });
export type RejectPayoutInput = z.infer<typeof rejectPayoutSchema>;

export interface PayoutDto {
  id: string;
  amountPaise: number;
  status: 'REQUESTED' | 'PAID' | 'REJECTED';
  method: 'UPI' | 'BANK' | null;
  destination: string | null;
  utr: string | null;
  note: string | null;
  requestedAt: string;
  paidAt: string | null;
}

export interface EarningsExamRow {
  examId: string;
  title: string;
  status: string;
  joins: number;
  grossPaise: number;
  sharePaise: number;
  /** ACCRUED until results are published, then PAYABLE. */
  state: 'ACCRUED' | 'PAYABLE';
}

export interface BalancesDto {
  /** Earned but not yet payable (exam results not published). */
  accruedPaise: number;
  /** Earned, released and not yet paid (can be negative after a refund that follows a payout). */
  netPaise: number;
  /** Payable now and not yet requested. */
  payablePaise: number;
  /** Already asked for, waiting for NandiVex to pay. */
  pendingPaise: number;
  paidPaise: number;
  /** Refunds taken back after payout; deducted from the next payouts. */
  owedBackPaise: number;
  minPayoutPaise: number;
}

export interface EarningsDto {
  balances: BalancesDto;
  exams: EarningsExamRow[];
  payouts: PayoutDto[];
  details: PayoutDetailsDto;
}

// ------------------------------------------------------------------- admin

export interface AdminPayableRow {
  examinerId: string;
  name: string;
  email: string;
  balances: BalancesDto;
  /** A payout the trainer asked for, if any. */
  request: PayoutDto | null;
  /** Full destination, for paying. Only admins get this. */
  destination: string | null;
  method: 'UPI' | 'BANK' | null;
  detailsVerified: boolean;
}

export const refundSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type RefundInput = z.infer<typeof refundSchema>;

export interface AdminPaymentRow {
  id: string;
  receiptNo: string;
  purpose: 'EXAM_CREATION' | 'EXAM_JOIN';
  status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'PENDING_REFUND' | 'REFUNDED';
  amountPaise: number;
  userName: string;
  userEmail: string;
  examTitle: string | null;
  quantity: number;
  capturedAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  /** Paid but nothing delivered: refund it by hand. */
  needsRefund: boolean;
}

export interface LedgerCheckDto {
  entries: number;
  transactions: number;
  /** Must be 0. */
  totalPaise: number;
  unbalancedTransactions: string[];
  platformPaise: number;
  owedToTrainersPaise: number;
  paidOutPaise: number;
  grossCollectedPaise: number;
}

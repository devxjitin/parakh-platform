/**
 * Business constants. Amounts are in paise (1 INR = 100 paise) to avoid float errors.
 * Prices are defaults; the admin console (Sprint 11) will make them configurable.
 */
export const PRICING = {
  /** Trainer pays this to create/publish an exam (BR-1). */
  EXAM_CREATION_PAISE: 99_00,
  /** Student pays this to join an exam (BR-2). */
  EXAM_JOIN_PAISE: 49_00,
  /** Examiner's share of each student-paid join fee, in percent (BR-3). */
  EXAMINER_SHARE_PERCENT: 50,
  /** Minimum payable balance before a manual payout is suggested. */
  MIN_PAYOUT_PAISE: 500_00,
  CURRENCY: 'INR',
} as const;

export const LIMITS = {
  MAX_QUESTIONS_PER_EXAM: 300,
  MAX_EXAM_DURATION_MINUTES: 360,
  MAX_STRIKES: 3,
  PRACTICE_ACCESS_DAYS: 90,
} as const;

export const BRAND = {
  COMPANY: 'NandiVex Technologies',
  PRODUCT: 'NandiRank',
} as const;

export const Role = {
  STUDENT: 'STUDENT',
  EXAMINER: 'EXAMINER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const QuestionType = {
  SINGLE: 'SINGLE',
  MULTI: 'MULTI',
  SUBJECTIVE: 'SUBJECTIVE',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const ExamStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  RESULTS_FINAL: 'RESULTS_FINAL',
  CANCELLED: 'CANCELLED',
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

export const AttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  AUTO_SUBMITTED: 'AUTO_SUBMITTED',
  GRADED: 'GRADED',
  RESULT_PUBLISHED: 'RESULT_PUBLISHED',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const CertificateStatus = {
  GENERATED: 'GENERATED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EMAILED: 'EMAILED',
} as const;
export type CertificateStatus = (typeof CertificateStatus)[keyof typeof CertificateStatus];

export const PayoutStatus = {
  REQUESTED: 'REQUESTED',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

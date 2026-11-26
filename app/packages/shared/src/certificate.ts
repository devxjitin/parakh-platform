import { z } from 'zod';

// ------------------------------------------------------------------ template

/** The one colour every certificate uses (NandiVex purple). Trainers cannot change it. */
export const CERT_ACCENT_HEX = '#7a3ce0';

/**
 * Who signs every certificate. Fixed: a trainer cannot change it. The signature image itself is in
 * the API (apps/api/src/certificates/signature.ts).
 */
export const CERT_SIGNATORY = {
  name: 'Chandra Prakash Tiwari',
  title: 'Founder, NandiVex Technologies',
} as const;

/** What a trainer controls about their exam's certificates: only whether they are given. */
export const certificateTemplateSchema = z.object({
  /** Turn certificates off for this exam. */
  enabled: z.boolean().default(true),
  /** Also give a Certificate of Participation to students below the pass mark. */
  participation: z.boolean().default(true),
  /** Give the trainer a Certificate of Appreciation for conducting the exam. */
  trainerCertificate: z.boolean().default(true),
});
export type CertificateTemplate = z.infer<typeof certificateTemplateSchema>;
export type CertificateTemplateInput = z.input<typeof certificateTemplateSchema>;

export const DEFAULT_CERT_TEMPLATE: CertificateTemplate = certificateTemplateSchema.parse({});

export { CERT_KIND_TITLE, type CertKind } from './certificate-kind';
import type { CertKind } from './certificate-kind';
export type StudentCertKind = 'ACHIEVEMENT' | 'PARTICIPATION';

/** Achievement at or above the pass mark; below it, participation (if the trainer allows it). */
export function certificateKind(percent: number, passPercent: number): StudentCertKind {
  return percent >= passPercent ? 'ACHIEVEMENT' : 'PARTICIPATION';
}

export const DEFAULT_CERT_MESSAGE = {
  ACHIEVEMENT: 'has successfully passed the exam',
  PARTICIPATION: 'has taken part in the exam',
  TRAINER: 'has successfully conducted the online exam',
} as const;

// --------------------------------------------------------------------- DTOs

export type CertStatus = 'GENERATED' | 'APPROVED' | 'REJECTED' | 'EMAILED';

/** What a student sees about their own certificate. */
export interface MyCertificateDto {
  id: string;
  serialNo: string;
  examTitle: string;
  kind: CertKind;
  /** PENDING until NandiVex approves it. Rejected ones are not shown. */
  state: 'PENDING' | 'ISSUED';
  issuedOn: string;
  verifyUrl: string;
}

export interface CertQueueExamDto {
  examId: string;
  examTitle: string;
  trainerName: string;
  waiting: number;
  approved: number;
  rejected: number;
}

export interface CertQueueRowDto {
  id: string;
  serialNo: string;
  examId: string;
  examTitle: string;
  holderName: string;
  holderEmail: string;
  kind: CertKind;
  scorePercent: number;
  /** Trainer certificates: how many students took the exam. */
  participants: number | null;
  status: CertStatus;
  pdfReady: boolean;
  /** Why the PDF could not be made, once the automatic retries have given up. */
  pdfError: string | null;
  rejectReason: string | null;
  emailedAt: string | null;
  emailError: string | null;
  emailBounced: boolean;
}

export interface TrainerCertificatesDto {
  enabled: boolean;
  finalized: boolean;
  total: number;
  waiting: number;
  issued: number;
  rejected: number;
  template: CertificateTemplate;
}

export type { VerifyState, VerifyCertificateDto } from './certificate-kind';

export const approveCertificatesSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
    examId: z.string().uuid().optional(),
  })
  .refine((v) => v.ids || v.examId, { message: 'Choose certificates or an exam' });
export type ApproveCertificatesInput = z.infer<typeof approveCertificatesSchema>;

export const rejectCertificatesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  reason: z.string().trim().min(3).max(300),
});
export type RejectCertificatesInput = z.infer<typeof rejectCertificatesSchema>;

/** Letters people can read out without mixing up 0/O and 1/I. */
/** Current serials are PRK-XXXX-XXXX; older certificates have a third block and still verify. */
export const SERIAL_PATTERN = /^PRK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4})?$/;

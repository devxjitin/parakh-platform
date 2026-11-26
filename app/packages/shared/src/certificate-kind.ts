/** Certificate kinds and the public verify answer. No dependencies, so the website can import it directly. */

export const CERT_KIND_TITLE = {
  ACHIEVEMENT: 'Certificate of Achievement',
  PARTICIPATION: 'Certificate of Participation',
  TRAINER: 'Certificate of Appreciation',
} as const;
/** ACHIEVEMENT and PARTICIPATION go to students; TRAINER goes to the trainer who ran the exam. */
export type CertKind = keyof typeof CERT_KIND_TITLE;

export type VerifyState = 'VALID' | 'REVOKED' | 'NOT_FOUND';

/** The public answer to "is this certificate real?". Never includes scores or emails. */
export interface VerifyCertificateDto {
  state: VerifyState;
  serialNo: string;
  holderName?: string;
  examTitle?: string;
  organisation?: string | null;
  kind?: CertKind;
  issuedOn?: string;
}

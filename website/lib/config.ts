/** Where the Parakh app lives. Sign in, Get started and Join links point here. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);
/** The Parakh API, used by the public certificate check. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** A link into the app, for example appUrl('/login/'). */
export const appUrl = (path: string) => `${APP_URL}${path}`;

/** Keep in sync with PRICING in the app's shared package. */
export const PRICING = {
  EXAM_CREATION_PAISE: 99_00,
  EXAM_JOIN_PAISE: 49_00,
  EXAMINER_SHARE_PERCENT: 50,
} as const;

export const formatInr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export const CERT_KIND_TITLE = {
  ACHIEVEMENT: 'Certificate of Achievement',
  PARTICIPATION: 'Certificate of Participation',
  TRAINER: 'Certificate of Appreciation',
} as const;
export type CertKind = keyof typeof CERT_KIND_TITLE;

export interface VerifyCertificateDto {
  state: 'VALID' | 'REVOKED' | 'NOT_FOUND';
  serialNo: string;
  holderName?: string;
  examTitle?: string;
  organisation?: string | null;
  kind?: CertKind;
  issuedOn?: string;
}

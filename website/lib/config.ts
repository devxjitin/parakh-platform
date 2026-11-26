/** Where the Parakh app lives. Sign in, Get started and Join links point here. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);
/** The Parakh API, used by the public certificate check. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** A link into the app, for example appUrl('/login/'). */
export const appUrl = (path: string) => `${APP_URL}${path}`;

/** Fallback prices, used until the live ones load. They come from the app's shared package. */
export { PRICING } from '@parakh/shared/constants';

/** The live prices from the API (admin Settings); the fallback above shows until they arrive. */
export interface LivePricing {
  EXAM_CREATION_PAISE: number;
  EXAM_JOIN_PAISE: number;
  EXAMINER_SHARE_PERCENT: number;
}

export const formatInr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export { CERT_KIND_TITLE, type CertKind, type VerifyCertificateDto } from '@parakh/shared/certificate-kind';

export type { CatalogExamDto } from '@parakh/shared/catalog';

export { REVIEW_PROMISE_HOURS } from '@parakh/shared/catalog';

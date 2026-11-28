/** Where the app is served (its own address). Set NEXT_PUBLIC_APP_URL at build time. */
export const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.nandirank.nandivex.com'
).replace(/\/$/, '');

/** Pages a visitor can open without signing in; these may appear in search results. */
export const PUBLIC_PATHS = [
  '/login/',
  '/register/',
  '/join/',
  '/verify/',
  '/terms/',
  '/privacy/',
  '/refund-policy/',
  '/contact/',
] as const;

/** Pages behind a sign-in. Kept out of search results. */
export const PRIVATE_PATHS = [
  '/admin/',
  '/attempt/',
  '/dashboard/',
  '/earnings/',
  '/exams/',
  '/forgot-password/',
  '/payment-return/',
  '/payments/',
  '/practice/',
  '/profile/',
  '/reset-password/',
  '/result/',
  '/verify-email/',
] as const;

/**
 * The public marketing website (a separate app, see /website). Set NEXT_PUBLIC_WEBSITE_URL for
 * production; locally it runs on port 3100.
 */
export const WEBSITE_URL = (process.env.NEXT_PUBLIC_WEBSITE_URL ?? 'http://localhost:3100').replace(
  /\/$/,
  '',
);

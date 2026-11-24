import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
  // Encrypts bank account numbers and signs certificates. Required in production.
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // The marketing website, which calls the public certificate check from the browser.
  WEBSITE_ORIGIN: z.string().optional(),
  MAIL_TRANSPORT: z.enum(['ses', 'smtp', 'log', 'memory']).default('log'),
  SES_FROM_EMAIL: z.string().default('no-reply@parakh.nandivex.com'),
  SES_CONFIGURATION_SET: z.string().optional(),
  // Used when MAIL_TRANSPORT=smtp. SMTP_SECURE defaults to true on port 465 and false otherwise.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Payments. 'fake' simulates the gateway (staging/dev only); 'razorpay' talks to the real API.
  PAYMENT_PROVIDER: z.enum(['fake', 'razorpay']).default('fake'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // The public address printed on certificates (QR code and "Verify at" line) and in emails.
  // Defaults to WEB_ORIGIN. Certificates outlive any one environment, so staging can point at
  // the production address too.
  VERIFY_BASE_URL: z.string().url().optional(),
  // 'on' starts the background jobs that make certificate PDFs and email approved ones.
  CERT_JOBS_POLL: z.enum(['on', 'off']).default('on'),
  // 'on' starts the job that emails each student their results, certificate and answer sheet.
  RESULTS_JOBS_POLL: z.enum(['on', 'off']).default('on'),
  // 'on' starts the job that sends exam reminders.
  NOTIFY_JOBS_POLL: z.enum(['on', 'off']).default('on'),
  // Secret in the URL of the endpoint that receives mail bounce notices from AWS SNS.
  SES_EVENTS_KEY: z.string().min(16).optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  // Private file storage (exam logos, later certificates). `memory` is for tests/local dev.
  STORAGE_DRIVER: z.enum(['s3', 'memory']).default('memory'),
  S3_BUCKET: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  OTP_TTL_MIN: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_SECONDS: z.coerce.number().default(60),
  LOGIN_MAX_FAILURES: z.coerce.number().default(5),
  LOCK_MINUTES: z.coerce.number().default(15),
  // Failures (from any network) before the whole account is locked. Far above LOGIN_MAX_FAILURES,
  // which only locks one email+IP pair.
  ACCOUNT_LOCK_FAILURES: z.coerce.number().default(20),
  // 'on' starts the hourly clean-up of stale sign-in records and unverified sign-ups.
  AUTH_JOBS_POLL: z.enum(['on', 'off']).default('on'),
  // 'on' starts the minute-by-minute job that ends attempts whose time ran out.
  SWEEP_JOBS_POLL: z.enum(['on', 'off']).default('on'),
  // Per-IP request ceilings (per minute). High on purpose: a classroom or college shares one public
  // IP. Brute-force and email flooding are limited per account, not per IP.
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().min(1).default(1200),
  RATE_LIMIT_LOGIN_IP_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_REFRESH_IP_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_SIGNUP_IP_PER_MIN: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_LOOKUP_IP_PER_MIN: z.coerce.number().int().min(1).default(300),
});

export type Env = z.infer<typeof schema> & { cookieSecure: boolean };

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const env = parsed.data;
  if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
    throw new Error('MAIL_TRANSPORT=smtp needs: SMTP_HOST');
  }
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    const missing = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'].filter(
      (k) => !source[k],
    );
    if (missing.length) throw new Error(`PAYMENT_PROVIDER=razorpay needs: ${missing.join(', ')}`);
  }
  if (env.NODE_ENV === 'production') {
    const bad: string[] = [];
    if (env.PAYMENT_PROVIDER === 'fake' && source.ALLOW_FAKE_PAYMENTS !== 'true') {
      bad.push('PAYMENT_PROVIDER=fake (set ALLOW_FAKE_PAYMENTS=true only on staging)');
    }
    if (env.STORAGE_DRIVER === 'memory')
      bad.push('STORAGE_DRIVER=memory (files would be lost on restart)');
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET)
      bad.push('S3_BUCKET is required with STORAGE_DRIVER=s3');
    if (env.MAIL_TRANSPORT !== 'ses' && env.MAIL_TRANSPORT !== 'smtp')
      bad.push('MAIL_TRANSPORT must be ses or smtp');
    if (!env.DATA_ENCRYPTION_KEY) bad.push('DATA_ENCRYPTION_KEY is required');
    if (!/^https:\/\//.test(env.WEB_ORIGIN)) bad.push('WEB_ORIGIN must be an https URL');
    if (bad.length) throw new Error('Unsafe production configuration: ' + bad.join('; '));
  }
  return {
    ...env,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  };
}

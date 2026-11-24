import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://parakh:parakh@localhost:5432/parakh_test';

// SWC is used so NestJS decorator metadata works under vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Tests share one real Postgres database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
      CERT_JOBS_POLL: 'off',
      RESULTS_JOBS_POLL: 'off',
      NOTIFY_JOBS_POLL: 'off',
      AUTH_JOBS_POLL: 'off',
      SWEEP_JOBS_POLL: 'off',
      VERIFY_BASE_URL: 'https://parakh.nandivex.in',
      SES_EVENTS_KEY: 'test-ses-events-key-0123456789',
      OTP_SECRET: 'test-otp-secret-0123456789abcdef0123456789ab',
      MAIL_TRANSPORT: 'memory',
      WEB_ORIGIN: 'http://localhost:3000',
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});

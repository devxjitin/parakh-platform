import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'k',
  RAZORPAY_KEY_SECRET: 's',
  RAZORPAY_WEBHOOK_SECRET: 'w',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'b',
  MAIL_TRANSPORT: 'ses',
  DATA_ENCRYPTION_KEY: 'c'.repeat(32),
  WEB_ORIGIN: 'https://parakh.nandivex.in',
};

describe('production guards', () => {
  it('accepts a safe production config', () => {
    expect(() => loadEnv(prod)).not.toThrow();
  });
  it('allows fake defaults outside production', () => {
    expect(() => loadEnv(base)).not.toThrow();
  });
  it.each([undefined, '', 'short'])(
    'refuses a missing or invalid production encryption key (%s)',
    (key) => {
      expect(() => loadEnv({ ...prod, DATA_ENCRYPTION_KEY: key })).toThrow(/DATA_ENCRYPTION_KEY/);
    },
  );
  it.each([
    ['fake payments', { PAYMENT_PROVIDER: 'fake' }],
    ['memory storage', { STORAGE_DRIVER: 'memory' }],
    ['log mail', { MAIL_TRANSPORT: 'log' }],
    ['http origin', { WEB_ORIGIN: 'http://parakh.nandivex.in' }],
  ])('refuses %s in production', (_n, over) => {
    expect(() => loadEnv({ ...prod, ...over })).toThrow(/Unsafe production/);
  });
  it('needs a host for smtp mail, and accepts smtp in production', () => {
    expect(() => loadEnv({ ...prod, MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() =>
      loadEnv({ ...prod, MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com' }),
    ).not.toThrow();
  });
  it('lets staging opt in to fake payments', () => {
    expect(() =>
      loadEnv({ ...prod, PAYMENT_PROVIDER: 'fake', ALLOW_FAKE_PAYMENTS: 'true' }),
    ).not.toThrow();
  });
});

describe('per-IP rate limit ceilings', () => {
  it('defaults to ceilings high enough for a classroom on one IP', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      RATE_LIMIT_IP_PER_MIN: 1200,
      RATE_LIMIT_LOGIN_IP_PER_MIN: 600,
      RATE_LIMIT_REFRESH_IP_PER_MIN: 600,
      RATE_LIMIT_SIGNUP_IP_PER_MIN: 120,
      RATE_LIMIT_LOOKUP_IP_PER_MIN: 300,
    });
  });
  it('can be changed from the environment', () => {
    const env = loadEnv({ ...base, RATE_LIMIT_LOGIN_IP_PER_MIN: '5000' });
    expect(env.RATE_LIMIT_LOGIN_IP_PER_MIN).toBe(5000);
  });
  it.each(['0', '-1', 'lots', '1.5'])('rejects %s', (value) => {
    expect(() => loadEnv({ ...base, RATE_LIMIT_IP_PER_MIN: value })).toThrow(
      /RATE_LIMIT_IP_PER_MIN/,
    );
  });
});

import type { Env } from '../config/env';

/**
 * Per-IP request ceilings, filled in once at start-up from the environment (RATE_LIMIT_*).
 *
 * These are ceilings, not the real protection. A classroom or college shares one public IP, so a
 * small per-IP limit locks out whole rooms of honest students. Brute-force and email-flooding are
 * stopped per account instead (see account-rate-limit.guard.ts); the IP ceilings only cap how
 * much one address can do overall.
 */
export const RATE = {
  /** Everything not listed below. */
  ipPerMin: 1200,
  /** Sign-in. Each attempt costs a password hash, so this is also a CPU guard. */
  loginIpPerMin: 600,
  /** Token renewal: every signed-in browser renews about every 15 minutes. */
  refreshIpPerMin: 600,
  /** Routes that send an email (register, resend code, forgot password): protects SES. */
  signupIpPerMin: 120,
  /** Exam-code and seat-link lookups. The codes and links are long random secrets. */
  lookupIpPerMin: 300,
};

export function applyRateLimits(env: Env): void {
  RATE.ipPerMin = env.RATE_LIMIT_IP_PER_MIN;
  RATE.loginIpPerMin = env.RATE_LIMIT_LOGIN_IP_PER_MIN;
  RATE.refreshIpPerMin = env.RATE_LIMIT_REFRESH_IP_PER_MIN;
  RATE.signupIpPerMin = env.RATE_LIMIT_SIGNUP_IP_PER_MIN;
  RATE.lookupIpPerMin = env.RATE_LIMIT_LOOKUP_IP_PER_MIN;
}

/** For `@Throttle({ default: perMinute(() => RATE.loginIpPerMin) })`: read at request time. */
export const perMinute = (pick: () => number) => ({ limit: () => pick(), ttl: 60_000 });

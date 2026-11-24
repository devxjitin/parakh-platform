import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type Type,
} from '@nestjs/common';

/**
 * 'email': one counter per email address, from any network. For routes that send mail, so
 * nobody can flood one person's inbox.
 * 'email+ip': one counter per email address AND network. For sign-in and code entry: someone
 * guessing a password only blocks themselves, never the real owner (who signs in from another
 * network) and never classmates on the same network (who use other emails).
 */
export type AccountKey = 'email' | 'email+ip';

const WINDOW_MS = 60_000;

/**
 * Builds a guard that allows `limit()` requests a minute per account key. Counts live in this
 * process, like the IP limiter's; one API server means one set of counts.
 */
export function accountRateLimit(mode: AccountKey, limit: () => number): Type<CanActivate> {
  @Injectable()
  class AccountRateLimitGuard implements CanActivate {
    private readonly hits = new Map<string, { windowStart: number; count: number }>();

    canActivate(context: ExecutionContext): boolean {
      // The IP limiter is off in tests, and so is this, unless a test turns limits on.
      if (process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST !== 'on') return true;

      const http = context.switchToHttp();
      const req = http.getRequest<{ body?: { email?: unknown }; ip?: string }>();
      const raw = req.body?.email;
      // No usable email: let the normal validation answer with a 400 instead.
      if (typeof raw !== 'string' || raw.trim() === '') return true;
      const email = raw.trim().toLowerCase().slice(0, 254);
      const key = mode === 'email+ip' ? `${email}|${req.ip ?? ''}` : email;

      const now = Date.now();
      if (this.hits.size > 5000) {
        for (const [k, v] of this.hits) {
          if (now - v.windowStart > WINDOW_MS) this.hits.delete(k);
        }
      }
      const entry = this.hits.get(key);
      if (!entry || now - entry.windowStart > WINDOW_MS) {
        this.hits.set(key, { windowStart: now, count: 1 });
        return true;
      }
      entry.count += 1;
      if (entry.count > limit()) {
        const wait = Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000));
        http
          .getResponse<{ setHeader: (k: string, v: string) => void }>()
          .setHeader('Retry-After', String(wait));
        throw new HttpException(
          'Too many attempts. Wait a minute and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    }
  }
  return AccountRateLimitGuard;
}

/** Sign-in and code entry: 10 tries a minute for one email from one network. */
export const SignInLimit = accountRateLimit('email+ip', () => 10);
/** Routes that send an email: 5 a minute for one address, from anywhere. */
export const EmailSendLimit = accountRateLimit('email', () => 5);

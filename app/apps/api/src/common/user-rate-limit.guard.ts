import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Per-user rate limit for the chatty attempt endpoints (autosave, proctor events). The normal
 * per-IP limit is off there because a whole classroom shares an IP; this one counts by user, so
 * one broken or abusive client cannot flood the API. 240 requests a minute is about 4x a busy
 * student's real traffic.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  static readonly LIMIT = 240;
  static readonly WINDOW_MS = 60_000;
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV === 'test') return true;
    const userId: string | undefined = context.switchToHttp().getRequest().user?.id;
    if (!userId) return true;
    const now = Date.now();
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (now - v.windowStart > UserRateLimitGuard.WINDOW_MS) this.hits.delete(k);
      }
    }
    const entry = this.hits.get(userId);
    if (!entry || now - entry.windowStart > UserRateLimitGuard.WINDOW_MS) {
      this.hits.set(userId, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    if (entry.count > UserRateLimitGuard.LIMIT) {
      throw new HttpException('Too many requests. Slow down.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

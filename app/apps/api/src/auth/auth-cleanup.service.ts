import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { withLeaderLock } from '../common/leader-lock';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** Hourly housekeeping: stale sign-in failure rows and sign-ups that were never verified. */
@Injectable()
export class AuthCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.AUTH_JOBS_POLL !== 'on') return;
    this.timer = setInterval(
      () => void withLeaderLock(this.prisma, 'auth-cleanup', () => this.runOnce()),
      3_600_000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<{ failures: number; users: number }> {
    try {
      const failures = await this.prisma.loginFailure.deleteMany({
        where: { updatedAt: { lt: new Date(now.getTime() - DAY_MS) } },
      });
      // Unverified for a week and never paid: nobody is coming back for this account.
      const users = await this.prisma.user.deleteMany({
        where: {
          emailVerifiedAt: null,
          role: { not: 'ADMIN' },
          createdAt: { lt: new Date(now.getTime() - 7 * DAY_MS) },
          payments: { none: {} },
        },
      });
      return { failures: failures.count, users: users.count };
    } catch (err) {
      this.logger.error('Auth clean-up failed', err as Error);
      return { failures: 0, users: 0 };
    }
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GRACE_MS } from '../common/timing';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from './grading.service';

/**
 * Every minute, ends attempts whose time ran out (students who just closed the tab) across all
 * exams, so they are submitted and marked without anyone opening Results.
 * Each attempt is claimed with a conditional update, so several servers can run it safely.
 */
@Injectable()
export class AttemptSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttemptSweeperService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.SWEEP_JOBS_POLL !== 'on') return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many attempts were ended. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const exams = await this.prisma.attempt.groupBy({
        by: ['examId'],
        where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(Date.now() - GRACE_MS) } },
      });
      let ended = 0;
      for (const e of exams) ended += await this.grading.settleOverdue(e.examId);
      return ended;
    } catch (err) {
      this.logger.error('Attempt sweep failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RESULT_RELEASE_DELAY_MIN } from '@parakh/shared';
import { CertificatesService } from '../certificates/certificates.service';
import { withLeaderLock } from '../common/leader-lock';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { renderAnswerSheet } from './answer-sheet';
import { toStudentResult } from './student-result';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;

/**
 * Sends each student ONE email with their score, certificate (when the exam gives one) and
 * answer sheet, as soon as that student's marking is complete and the exam has been closed for a
 * short review window. Objective-only exams need no trainer action at all; for written papers a
 * student's email goes out the moment the trainer finishes marking them.
 *
 * "Publish results" in the trainer's panel releases everyone who is ready straight away.
 * Safe to run on several servers: each student is claimed with a conditional update.
 */
@Injectable()
export class ResultsDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResultsDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly certificates: CertificatesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.RESULTS_JOBS_POLL !== 'on') return;
    this.timer = setInterval(
      () => void withLeaderLock(this.prisma, 'results-delivery', () => this.sweep()),
      30_000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over students who are ready and have not been emailed. Returns how many were sent. */
  async sweep(opts: { ignoreDelay?: boolean } = {}): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const releasedBefore = new Date(Date.now() - RESULT_RELEASE_DELAY_MIN * 60_000);
      const now = new Date();
      const rows = await this.prisma.attempt.findMany({
        where: {
          resultEmailedAt: null,
          resultEmailAttempts: { lt: MAX_ATTEMPTS },
          OR: [{ resultEmailLockUntil: null }, { resultEmailLockUntil: { lt: now } }],
          status: { in: ['GRADED', 'RESULT_PUBLISHED'] },
          exam: {
            OR: [
              { status: 'RESULTS_FINAL' },
              // Always-open exams never close: each attempt goes out as soon as it is fully marked.
              { status: 'PUBLISHED', alwaysOpen: true },
              {
                status: 'PUBLISHED',
                endsAt: opts.ignoreDelay ? { lte: now } : { lte: releasedBefore },
              },
            ],
          },
        },
        orderBy: { gradedAt: 'asc' },
        take: 25,
        select: { id: true },
      });
      let sent = 0;
      for (const r of rows) if (await this.deliver(r.id)) sent++;
      return sent;
    } catch (err) {
      this.logger.error('Results delivery failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Sends everyone of this exam who has not been emailed yet (used by "Publish results"). */
  async deliverExam(examId: string): Promise<number> {
    const rows = await this.prisma.attempt.findMany({
      where: {
        examId,
        resultEmailedAt: null,
        resultEmailAttempts: { lt: MAX_ATTEMPTS },
        status: { in: ['GRADED', 'RESULT_PUBLISHED'] },
      },
      select: { id: true },
    });
    let sent = 0;
    for (const r of rows) if (await this.deliver(r.id)) sent++;
    return sent;
  }

  /**
   * Objective-only exams (no written questions) have nothing left for a trainer to mark, so the
   * student's score, answer key and certificate are emailed the moment they finish, without
   * waiting for the exam window to close. Does nothing for papers with written answers.
   * Always-open exams release every attempt on its own as soon as it is fully marked, so a
   * written paper goes out the moment the admin finishes marking it.
   */
  async deliverIfObjective(attemptId: string): Promise<boolean> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        resultEmailedAt: true,
        exam: {
          select: {
            alwaysOpen: true,
            questions: { where: { type: 'SUBJECTIVE' }, select: { id: true } },
          },
        },
      },
    });
    if (!attempt || attempt.status !== 'GRADED' || attempt.resultEmailedAt) return false;
    if (!attempt.exam.alwaysOpen && attempt.exam.questions.length > 0) return false;
    return this.deliver(attemptId);
  }

  /** Sends one student's email. Returns false when it was not sent (it is retried later). */
  async deliver(attemptId: string): Promise<boolean> {
    const claimed = await this.prisma.attempt.updateMany({
      where: {
        id: attemptId,
        resultEmailedAt: null,
        OR: [{ resultEmailLockUntil: null }, { resultEmailLockUntil: { lt: new Date() } }],
      },
      data: { resultEmailLockUntil: new Date(Date.now() + LOCK_MS) },
    });
    if (claimed.count === 0) return false;

    try {
      const attempt = await this.prisma.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: {
          student: { select: { email: true, name: true } },
          answers: true,
          exam: { include: { questions: true } },
        },
      });
      if (attempt.score === null || attempt.percent === null) {
        // Still being marked: let it be picked up again once marking is done.
        await this.prisma.attempt.update({
          where: { id: attemptId },
          data: { resultEmailLockUntil: null },
        });
        return false;
      }

      const result = toStudentResult(attempt);
      const answerSheet = await renderAnswerSheet({
        studentName: attempt.student.name,
        result,
      });
      const certificate = await this.certificates.forResultsEmail(attemptId);
      await this.mail.sendResultsPackage(attempt.student.email, attempt.student.name, {
        examTitle: attempt.exam.title,
        score: result.score,
        maxScore: result.maxScore,
        percent: result.percent,
        passed: result.passed,
        answerSheet,
        certificate: certificate ?? undefined,
      });

      // Sent. From now on the student can open the result page too, and the marks are locked.
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          resultEmailedAt: new Date(),
          resultEmailLockUntil: null,
          status: 'RESULT_PUBLISHED',
        },
      });
      if (certificate) await this.certificates.markEmailed(certificate.id);
      return true;
    } catch (err) {
      this.logger.warn(`Results email for attempt ${attemptId} failed: ${(err as Error).message}`);
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          resultEmailAttempts: { increment: 1 },
          // Wait a little longer after each failure.
          resultEmailLockUntil: new Date(Date.now() + 60_000 * 2),
        },
      });
      return false;
    }
  }
}

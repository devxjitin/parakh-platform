import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PRACTICE } from '@parakh/shared';
import { withLeaderLock } from '../common/leader-lock';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

/** How far ahead of the start time students are reminded. */
export const REMINDER_WINDOW_MS = 24 * 3_600_000;

// No 0/O/1/I/L so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePracticeCode(): string {
  let tail = '';
  for (let i = 0; i < 6; i++) tail += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `PRC-${tail}`;
}

const DAY_MS = 86_400_000;
/** Days after an exam closes before the trainer is reminded, and before the admins are told. */
export const RESULTS_REMINDER_DAYS = 3;
export const RESULTS_ESCALATE_DAYS = 7;

/** Background notifications. Safe to run on several servers: each reminder is claimed once. */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private sendingPractice = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.NOTIFY_JOBS_POLL !== 'on') return;
    this.timer = setInterval(
      () =>
        void withLeaderLock(this.prisma, 'notifications', () =>
          Promise.all([this.sendReminders(), this.sendPracticeCodes(), this.sendResultsOverdue()]),
        ),
      60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Emails students who joined an exam that starts within a day and have not started it. Each
   * enrollment is claimed before its email goes out, so nobody gets two.
   */
  async sendReminders(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.enrollment.findMany({
        where: {
          reminderSentAt: null,
          attempt: null,
          exam: {
            status: 'PUBLISHED',
            startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) },
          },
        },
        include: {
          student: { select: { email: true, name: true, status: true } },
          exam: { select: { title: true, startsAt: true, durationMinutes: true } },
        },
        take: 200,
      });
      let sent = 0;
      for (const e of due) {
        const claimed = await this.prisma.enrollment.updateMany({
          where: { id: e.id, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        if (claimed.count === 0 || e.student.status !== 'ACTIVE' || !e.exam.startsAt) continue;
        await this.mail.sendExamReminder(e.student.email, e.student.name, {
          examTitle: e.exam.title,
          startsAt: e.exam.startsAt,
          durationMinutes: e.exam.durationMinutes,
        });
        sent++;
      }
      return sent;
    } catch (err) {
      this.logger.error('Reminder job failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Scheduled exams whose results are still unpublished after they closed: the trainer is reminded
   * after 3 days and the admins are told after 7. Each step is claimed first, so it goes out once.
   * Returns how many emails were sent.
   */
  async sendResultsOverdue(now = new Date()): Promise<number> {
    try {
      let sent = 0;
      const base = { status: 'PUBLISHED' as const, alwaysOpen: false };
      const include = {
        examiner: { select: { email: true, name: true, status: true } },
        _count: { select: { attempts: true } },
      };
      const reminders = await this.prisma.exam.findMany({
        where: {
          ...base,
          resultsReminderSentAt: null,
          endsAt: { lte: new Date(now.getTime() - RESULTS_REMINDER_DAYS * DAY_MS) },
        },
        include,
        take: 100,
      });
      for (const e of reminders) {
        const claimed = await this.prisma.exam.updateMany({
          where: { id: e.id, resultsReminderSentAt: null, status: 'PUBLISHED' },
          data: { resultsReminderSentAt: now },
        });
        if (claimed.count === 0 || e.examiner.status !== 'ACTIVE' || e._count.attempts === 0)
          continue;
        await this.mail.sendResultsOverdue(e.examiner.email, e.examiner.name, {
          examTitle: e.title,
          days: RESULTS_REMINDER_DAYS,
          waiting: e._count.attempts,
        });
        sent++;
      }
      const escalations = await this.prisma.exam.findMany({
        where: {
          ...base,
          resultsEscalatedAt: null,
          endsAt: { lte: new Date(now.getTime() - RESULTS_ESCALATE_DAYS * DAY_MS) },
        },
        include,
        take: 100,
      });
      for (const e of escalations) {
        const claimed = await this.prisma.exam.updateMany({
          where: { id: e.id, resultsEscalatedAt: null, status: 'PUBLISHED' },
          data: { resultsEscalatedAt: now },
        });
        if (claimed.count === 0 || e._count.attempts === 0) continue;
        const admins = await this.prisma.user.findMany({
          where: { role: 'ADMIN', status: 'ACTIVE' },
          select: { email: true, name: true },
        });
        for (const a of admins) {
          await this.mail.sendResultsOverdue(a.email, a.name, {
            examTitle: e.title,
            days: RESULTS_ESCALATE_DAYS,
            waiting: e._count.attempts,
            forAdmin: { trainer: e.examiner.name },
          });
          sent++;
        }
      }
      return sent;
    } catch (err) {
      this.logger.error('Results overdue job failed', err as Error);
      return 0;
    }
  }

  /**
   * Once an exam has closed, every student who handed in an attempt gets a practice code by email.
   * It opens the same questions for free practice (no payment, no certificate, no effect on the
   * score). Each student is claimed before the email goes out, so nobody gets two.
   */
  async sendPracticeCodes(now = new Date()): Promise<number> {
    if (this.sendingPractice) return 0;
    this.sendingPractice = true;
    try {
      // Attempts that are over, in an exam that has closed, whose student has not been emailed yet.
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a."id" FROM "Attempt" a
        JOIN "Exam" e ON e."id" = a."examId"
        LEFT JOIN "PracticeAccess" p ON p."studentId" = a."studentId" AND p."examId" = a."examId"
        WHERE a."status" <> 'IN_PROGRESS'
          AND e."alwaysOpen" = false
          AND (e."status" = 'RESULTS_FINAL' OR (e."status" = 'PUBLISHED' AND e."endsAt" <= ${now}))
          AND p."emailedAt" IS NULL
        LIMIT 300`;
      const due = await this.prisma.attempt.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        include: {
          student: { select: { id: true, email: true, name: true, status: true } },
          exam: {
            select: {
              id: true,
              title: true,
              endsAt: true,
              resultsPublishedAt: true,
              updatedAt: true,
            },
          },
        },
      });
      let sent = 0;
      for (const a of due) {
        if (a.student.status !== 'ACTIVE') continue;
        const code = await this.claimPracticeCode(a.studentId, a.examId, now);
        if (!code) continue;
        const closed = a.exam.endsAt ?? a.exam.resultsPublishedAt ?? a.exam.updatedAt;
        await this.mail.sendPracticeCode(a.student.email, a.student.name, {
          examTitle: a.exam.title,
          code,
          expiresAt: new Date(closed.getTime() + PRACTICE.EXPIRY_DAYS * DAY_MS),
        });
        sent++;
      }
      return sent;
    } catch (err) {
      this.logger.error('Practice code job failed', err as Error);
      return 0;
    } finally {
      this.sendingPractice = false;
    }
  }

  /** Gives this student's practice access a code, once. Returns null if another run got there first. */
  private async claimPracticeCode(studentId: string, examId: string, now: Date) {
    await this.prisma.practiceAccess.upsert({
      where: { studentId_examId: { studentId, examId } },
      create: { studentId, examId },
      update: {},
    });
    for (let i = 0; i < 5; i++) {
      const code = generatePracticeCode();
      try {
        const claimed = await this.prisma.practiceAccess.updateMany({
          where: { studentId, examId, emailedAt: null },
          data: { code, emailedAt: now },
        });
        return claimed.count === 1 ? code : null;
      } catch (err) {
        // Two students drew the same code: draw again.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
      }
    }
    return null;
  }
}

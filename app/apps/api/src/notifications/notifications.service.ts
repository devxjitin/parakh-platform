import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PRACTICE } from '@parakh/shared';
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
    this.timer = setInterval(() => {
      void this.sendReminders();
      void this.sendPracticeCodes();
    }, 60_000);
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

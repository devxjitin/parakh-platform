import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CancelExamResultDto,
  CloseExamResultDto,
  RescheduleExamInput,
  RescheduleExamResultDto,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

const UUID = /^[0-9a-f-]{36}$/i;

/** Changes to an exam after it is published: close early, cancel (and admin suspend). */
@Injectable()
export class ExamLifecycleService {
  private readonly logger = new Logger(ExamLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Emails every active student with a seat that the exam was cancelled. Runs in the background
   * one email at a time, so cancelling a big exam returns at once; one failed email never stops
   * the rest.
   */
  private async notifyCancelled(
    examId: string,
    examTitle: string,
    reason: string,
    students: { email: string; name: string; status: string; refunded: boolean }[],
  ): Promise<void> {
    let sent = 0;
    try {
      for (const s of students) {
        if (s.status !== 'ACTIVE') continue;
        await this.mail.sendExamCancelled(s.email, s.name, {
          examTitle,
          reason,
          refunded: s.refunded,
        });
        sent++;
      }
    } catch (err) {
      this.logger.error('Could not email all students about a cancelled exam', err as Error);
    }
    await this.audit.log({
      action: 'exam.cancel.notified',
      entity: 'Exam',
      entityId: examId,
      meta: { sent, total: students.length },
    });
  }

  private async refundUnstarted(
    actor: AuthUser,
    examId: string,
    paymentIds: string[],
    reason: string,
  ): Promise<void> {
    for (const id of paymentIds) {
      try {
        await this.payments.refund(actor, id, `Exam cancelled: ${reason}`.slice(0, 200));
      } catch (err) {
        // An unknown outcome stays PENDING_REFUND for the sweeper; anything else needs a person.
        this.logger.error(`Refund on cancel failed for payment ${id}`, err as Error);
        await this.prisma.payment
          .updateMany({ where: { id, status: 'CAPTURED' }, data: { needsRefund: true } })
          .catch(() => undefined);
      }
    }
    await this.audit.log({
      action: 'exam.cancel.refunds',
      entity: 'Exam',
      entityId: examId,
      meta: { attempted: paymentIds.length },
    });
  }

  private async load(examId: string, ownerId?: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({
          where: { id: examId, ...(ownerId ? { examinerId: ownerId } : {}) },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /**
   * Moves the window of a published exam that has not opened yet and that no student has started.
   * Joined students are emailed the new time and get their "starts soon" reminder again.
   */
  async reschedule(
    user: AuthUser,
    examId: string,
    input: RescheduleExamInput,
  ): Promise<RescheduleExamResultDto> {
    const exam = await this.load(examId, user.id);
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published exam can be rescheduled');
    }
    if (exam.alwaysOpen) throw new ConflictException('An always-open exam has no schedule');
    const now = new Date();
    if (!exam.startsAt || exam.startsAt <= now) {
      throw new ConflictException('This exam has already opened, so it cannot be rescheduled');
    }
    const startsAt = new Date(input.startsAt);
    if (startsAt <= now) throw new BadRequestException('Choose a start time in the future');
    const endsAt = input.endsAt
      ? new Date(input.endsAt)
      : new Date(startsAt.getTime() + exam.durationMinutes * 60_000);
    if (endsAt.getTime() - startsAt.getTime() < exam.durationMinutes * 60_000) {
      throw new BadRequestException(
        `The window must be at least ${exam.durationMinutes} minutes, the length of the exam`,
      );
    }
    // The window is only moved while nobody has started: the update itself re-checks it.
    const moved = await this.prisma.$transaction(async (tx) => {
      if ((await tx.attempt.count({ where: { examId: exam.id } })) > 0) return false;
      const res = await tx.exam.updateMany({
        where: { id: exam.id, status: 'PUBLISHED', startsAt: { gt: now } },
        data: { startsAt, endsAt },
      });
      if (res.count === 0) return false;
      await tx.enrollment.updateMany({
        where: { examId: exam.id },
        data: { reminderSentAt: null },
      });
      return true;
    });
    if (!moved) throw new ConflictException('This exam can no longer be rescheduled');

    const joined = await this.prisma.enrollment.findMany({
      where: { examId: exam.id },
      select: { student: { select: { email: true, name: true, status: true } } },
    });
    const students = joined.map((e) => e.student).filter((s) => s.status === 'ACTIVE');
    await this.audit.log({
      actorId: user.id,
      action: 'exam.reschedule',
      entity: 'Exam',
      entityId: exam.id,
      meta: { from: exam.startsAt, to: startsAt, endsAt, students: students.length },
    });
    // Not awaited: a big exam must not make the trainer wait, and one bad address stops nothing.
    void (async () => {
      for (const s of students) {
        try {
          await this.mail.sendExamRescheduled(s.email, s.name, {
            examTitle: exam.title,
            startsAt,
            endsAt,
            durationMinutes: exam.durationMinutes,
          });
        } catch (err) {
          this.logger.error('Could not email a student about a new exam time', err as Error);
        }
      }
    })();
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notified: students.length,
    };
  }

  /** Stops new students from starting. Students already sitting the exam finish normally. */
  async close(user: AuthUser, examId: string): Promise<CloseExamResultDto> {
    const exam = await this.load(examId, user.id);
    if (exam.status !== 'PUBLISHED')
      throw new ConflictException('This exam is not open for changes');
    const now = new Date();
    if (exam.endsAt && exam.endsAt <= now)
      throw new ConflictException('This exam is already closed');
    // Before the start, "close" would set the end earlier than the start and lock out students who
    // already paid. Such an exam has to be cancelled (or simply left to run).
    if (exam.startsAt && exam.startsAt > now) {
      throw new ConflictException(
        'This exam has not started yet, so it cannot be closed. Cancel it instead, or let it run.',
      );
    }
    // An always-open exam is retired the same way: nobody new can buy it, it leaves the public
    // list, and students who already paid can still take it (see AttemptsService.start).
    await this.prisma.exam.update({
      where: { id: exam.id },
      data: { endsAt: now, ...(exam.alwaysOpen ? { listedPublicly: false } : {}) },
    });
    const stillRunning = await this.prisma.attempt.count({
      where: { examId: exam.id, status: 'IN_PROGRESS' },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'exam.close',
      entity: 'Exam',
      entityId: exam.id,
      meta: { stillRunning },
    });
    return { closedAt: now.toISOString(), stillRunning };
  }

  /**
   * Cancels the exam. Every student who paid and had not started is refunded automatically (owner
   * policy, 2026-11-25): the gateway returns the money and the trainer share is reversed. Students
   * who already started are not refunded. Fees a trainer paid for sponsored seats are not refunded
   * here.
   */
  async cancel(
    actor: AuthUser,
    examId: string,
    input: { reason: string; force?: boolean },
    asAdmin = false,
  ): Promise<CancelExamResultDto> {
    const exam = await this.load(examId, asAdmin ? undefined : actor.id);
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published exam can be cancelled');
    }
    const started = await this.prisma.attempt.count({ where: { examId: exam.id } });
    if (started > 0 && !input.force && !asAdmin) {
      throw new ConflictException(
        started +
          ' student(s) have already started this exam. Close it instead, or cancel with force.',
      );
    }

    // Claim first, so two cancels cannot both run.
    const claimed = await this.prisma.exam.updateMany({
      where: { id: exam.id, status: 'PUBLISHED' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) throw new ConflictException('This exam was already changed');

    const enrolled = await this.prisma.enrollment.findMany({
      where: { examId: exam.id },
      select: {
        student: { select: { email: true, name: true, status: true } },
        attempt: { select: { id: true } },
        payment: { select: { id: true, status: true, purpose: true } },
      },
    });
    const students = enrolled.length;
    const toRefund = enrolled.filter(
      (e) => !e.attempt && e.payment?.purpose === 'EXAM_JOIN' && e.payment.status === 'CAPTURED',
    );
    await this.audit.log({
      actorId: actor.id,
      action: asAdmin ? 'exam.suspend' : 'exam.cancel',
      entity: 'Exam',
      entityId: exam.id,
      meta: { reason: input.reason, started, students, refunding: toRefund.length },
    });
    // Not awaited on purpose: see notifyCancelled. Refunds go first, one at a time; a refund that
    // cannot finish stays PENDING_REFUND for the sweeper, or is flagged for an admin.
    void this.refundUnstarted(
      actor,
      exam.id,
      toRefund.map((e) => e.payment!.id),
      input.reason,
    ).then(() =>
      this.notifyCancelled(
        exam.id,
        exam.title,
        input.reason,
        enrolled.map((e) => ({
          ...e.student,
          refunded: toRefund.includes(e),
        })),
      ),
    );
    return { status: 'CANCELLED', students, refunding: toRefund.length };
  }
}

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CancelExamResultDto, CloseExamResultDto } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f-]{36}$/i;

/** Changes to an exam after it is published: close early, cancel (and admin suspend). */
@Injectable()
export class ExamLifecycleService {
  private readonly logger = new Logger(ExamLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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
    students: { email: string; name: string; status: string }[],
  ): Promise<void> {
    let sent = 0;
    try {
      for (const s of students) {
        if (s.status !== 'ACTIVE') continue;
        await this.mail.sendExamCancelled(s.email, s.name, { examTitle, reason });
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

  private async load(examId: string, ownerId?: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({
          where: { id: examId, ...(ownerId ? { examinerId: ownerId } : {}) },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /** Stops new students from starting. Students already sitting the exam finish normally. */
  async close(user: AuthUser, examId: string): Promise<CloseExamResultDto> {
    const exam = await this.load(examId, user.id);
    if (exam.status !== 'PUBLISHED')
      throw new ConflictException('This exam is not open for changes');
    const now = new Date();
    if (exam.endsAt && exam.endsAt <= now)
      throw new ConflictException('This exam is already closed');
    await this.prisma.exam.update({ where: { id: exam.id }, data: { endsAt: now } });
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
   * Cancels the exam. Nothing is refunded: once a fee is paid it is not refundable, even if the
   * exam is cancelled (owner policy, 2026-11-22). An admin can still refund one payment by hand.
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
      select: { student: { select: { email: true, name: true, status: true } } },
    });
    const students = enrolled.length;
    await this.audit.log({
      actorId: actor.id,
      action: asAdmin ? 'exam.suspend' : 'exam.cancel',
      entity: 'Exam',
      entityId: exam.id,
      meta: { reason: input.reason, started, students },
    });
    // Not awaited on purpose: see notifyCancelled.
    void this.notifyCancelled(
      exam.id,
      exam.title,
      input.reason,
      enrolled.map((e) => e.student),
    );
    return { status: 'CANCELLED', students };
  }
}

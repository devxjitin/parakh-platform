import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddTimeInput,
  ExtraMinutesInput,
  ReopenAttemptInput,
  RosterRowDto,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { GRACE_MS } from '../common/timing';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f-]{36}$/i;

/** Per-student adjustments by the trainer: extra time, more time while sitting, and reopening. */
@Injectable()
export class AccommodationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadExam(user: AuthUser, examId: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({ where: { id: examId, examinerId: user.id } })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException(
        'Results are published or the exam was cancelled, so this can no longer change',
      );
    }
    return exam;
  }

  private async loadAttempt(examId: string, attemptId: string) {
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({ where: { id: attemptId, examId } })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  /** Everyone enrolled, with their extra time and whether they have started. */
  async roster(user: AuthUser, examId: string): Promise<RosterRowDto[]> {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({ where: { id: examId, examinerId: user.id } })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    const rows = await this.prisma.enrollment.findMany({
      where: { examId: exam.id },
      include: {
        student: { select: { name: true, email: true } },
        attempt: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      enrollmentId: r.id,
      name: r.student.name,
      email: r.student.email,
      extraMinutes: r.extraMinutes,
      started: r.attempt !== null,
    }));
  }

  /** Extra time for a student who has not started yet. */
  async setExtraMinutes(
    user: AuthUser,
    examId: string,
    enrollmentId: string,
    input: ExtraMinutesInput,
  ) {
    const exam = await this.loadExam(user, examId);
    const enrollment = UUID.test(enrollmentId)
      ? await this.prisma.enrollment.findFirst({
          where: { id: enrollmentId, examId: exam.id },
          include: { attempt: { select: { id: true } } },
        })
      : null;
    if (!enrollment) throw new NotFoundException('Student not found');
    if (enrollment.attempt) {
      throw new ConflictException('This student already started. Use "Add time" on their attempt.');
    }
    await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { extraMinutes: input.minutes },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'enrollment.extra_minutes',
      entity: 'Enrollment',
      entityId: enrollment.id,
      meta: { examId: exam.id, from: enrollment.extraMinutes, to: input.minutes },
    });
    return { extraMinutes: input.minutes };
  }

  /** Moves a running attempt's deadline later. */
  async addTime(user: AuthUser, examId: string, attemptId: string, input: AddTimeInput) {
    const exam = await this.loadExam(user, examId);
    const attempt = await this.loadAttempt(exam.id, attemptId);
    if (attempt.status !== 'IN_PROGRESS' || Date.now() >= attempt.deadlineAt.getTime() + GRACE_MS) {
      throw new ConflictException('This attempt is no longer running. Reopen it instead.');
    }
    const deadlineAt = new Date(attempt.deadlineAt.getTime() + input.minutes * 60_000);
    const moved = await this.prisma.attempt.updateMany({
      where: { id: attempt.id, status: 'IN_PROGRESS', deadlineAt: attempt.deadlineAt },
      data: { deadlineAt },
    });
    if (moved.count === 0) throw new ConflictException('The attempt just changed. Try again.');
    await this.audit.log({
      actorId: user.id,
      action: 'attempt.add_time',
      entity: 'Attempt',
      entityId: attempt.id,
      meta: { examId: exam.id, minutes: input.minutes, reason: input.reason },
    });
    return { deadlineAt: deadlineAt.toISOString() };
  }

  /**
   * Puts a finished attempt back in progress with a fresh deadline. Written marks are
   * cleared, because the student may change those answers; choice answers are marked again at
   * submit. Not possible once results are published.
   */
  async reopen(user: AuthUser, examId: string, attemptId: string, input: ReopenAttemptInput) {
    const exam = await this.loadExam(user, examId);
    const attempt = await this.loadAttempt(exam.id, attemptId);
    const deadlineAt = new Date(Date.now() + input.minutes * 60_000);
    const reopened = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.attempt.updateMany({
        where: { id: attempt.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'GRADED'] } },
        data: {
          status: 'IN_PROGRESS',
          endReason: null,
          submittedAt: null,
          deadlineAt,
          lastSeenAt: new Date(),
          score: null,
          maxScore: null,
          percent: null,
          passed: null,
          gradedAt: null,
          ...(input.resetStrikes ? { strikes: 0 } : {}),
        },
      });
      if (flipped.count === 0) return false;
      const written = await tx.question.findMany({
        where: { examId: exam.id, type: 'SUBJECTIVE' },
        select: { id: true },
      });
      await tx.answer.updateMany({
        where: { attemptId: attempt.id, questionId: { in: written.map((q) => q.id) } },
        data: { marksAwarded: null, gradedAt: null },
      });
      return true;
    });
    if (!reopened) {
      throw new ConflictException(
        attempt.status === 'IN_PROGRESS'
          ? 'This attempt is still running'
          : 'Results are published for this attempt, so it cannot be reopened',
      );
    }
    await this.audit.log({
      actorId: user.id,
      action: 'attempt.reopen',
      entity: 'Attempt',
      entityId: attempt.id,
      meta: {
        examId: exam.id,
        minutes: input.minutes,
        reason: input.reason,
        resetStrikes: Boolean(input.resetStrikes),
        previous: attempt.endReason,
      },
    });
    return { deadlineAt: deadlineAt.toISOString() };
  }
}

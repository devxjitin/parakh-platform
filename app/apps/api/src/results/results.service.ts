import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  integrityFlags,
  round2,
  type AttemptHistoryDto,
  type AttemptRowDto,
  type ExamResultsDto,
  type GradeAnswerInput,
  type GradingAttemptDto,
  type StudentResultDto,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CertificatesService } from '../certificates/certificates.service';
import { GradingService } from './grading.service';
import { ResultsDeliveryService } from './results-delivery.service';
import { toStudentResult } from './student-result';

const UUID = /^[0-9a-f-]{36}$/i;

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    private readonly audit: AuditService,
    private readonly certificates: CertificatesService,
    private readonly delivery: ResultsDeliveryService,
  ) {}

  // ---------------------------------------------------------------- trainer

  private async findOwned(user: AuthUser, examId: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({
          // An admin also marks the always-open exams: they have no trainer.
          where: {
            id: examId,
            OR: [{ examinerId: user.id }, ...(user.role === 'ADMIN' ? [{ alwaysOpen: true }] : [])],
          },
          include: { questions: { orderBy: { position: 'asc' } } },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /** Brings every attempt up to date: time-outs applied, choice answers marked. */
  private async refresh(examId: string): Promise<void> {
    await this.grading.settleOverdue(examId);
    const stale = await this.prisma.attempt.findMany({
      where: {
        examId,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        score: null,
        answers: { none: { marksAwarded: { not: null } } },
      },
      select: { id: true },
    });
    for (const a of stale) await this.grading.gradeAttempt(a.id);
  }

  async results(user: AuthUser, examId: string): Promise<ExamResultsDto> {
    const exam = await this.findOwned(user, examId);
    await this.refresh(exam.id);

    const writtenIds = exam.questions.filter((q) => q.type === 'SUBJECTIVE').map((q) => q.id);
    const attempts = await this.prisma.attempt.findMany({
      where: { examId: exam.id },
      orderBy: { startedAt: 'asc' },
      include: {
        student: { select: { name: true, email: true } },
        answers: { where: { questionId: { in: writtenIds } } },
        events: { where: { type: 'DEVICE_MISMATCH' }, select: { id: true } },
        _count: { select: { events: true } },
      },
    });
    const devices = new Map<string, number>();
    for (const a of attempts) {
      if (a.deviceId) devices.set(a.deviceId, (devices.get(a.deviceId) ?? 0) + 1);
    }
    const enrolled = await this.prisma.enrollment.count({ where: { examId: exam.id } });

    const rows: AttemptRowDto[] = attempts.map((a) => ({
      attemptId: a.id,
      studentName: a.student.name,
      studentEmail: a.student.email,
      status: a.status,
      endReason: a.endReason,
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt?.toISOString() ?? null,
      strikes: a.strikes,
      violations: a._count.events,
      pendingGrading: a.answers.filter((x) => x.text?.trim() && x.marksAwarded === null).length,
      flags: integrityFlags({
        hasDeviceId: Boolean(a.deviceId),
        sharedDeviceCount: a.deviceId ? (devices.get(a.deviceId) ?? 1) - 1 : 0,
        mismatchEvents: a.events.length,
        startIp: a.startIp,
        lastIp: a.lastIp,
      }).map((x) => x.code),
      score: a.score,
      maxScore: a.maxScore,
      percent: a.percent,
      passed: a.passed,
    }));

    const scored = rows.filter((r) => r.percent !== null);
    return {
      exam: {
        id: exam.id,
        title: exam.title,
        status: exam.status,
        passPercent: exam.passPercent,
        totalMarks: this.totalFor(exam),
        enrolled,
      },
      stats: {
        attempts: rows.length,
        submitted: rows.filter((r) => r.status !== 'IN_PROGRESS').length,
        inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
        pendingGrading: rows.reduce((s, r) => s + r.pendingGrading, 0),
        average: scored.length
          ? round2(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length)
          : null,
        highest: scored.length ? Math.max(...scored.map((r) => r.score ?? 0)) : null,
        passRate: scored.length
          ? round2((scored.filter((r) => r.passed).length / scored.length) * 100)
          : null,
      },
      finalized: exam.status === 'RESULTS_FINAL',
      rows,
    };
  }

  async attemptDetail(
    user: AuthUser,
    examId: string,
    attemptId: string,
  ): Promise<GradingAttemptDto> {
    const exam = await this.findOwned(user, examId);
    await this.grading.settleOverdue(exam.id);
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({
          where: { id: attemptId, examId: exam.id },
          include: {
            student: { select: { name: true, email: true } },
            answers: true,
            events: { orderBy: { createdAt: 'asc' } },
          },
        })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status === 'IN_PROGRESS') {
      throw new ConflictException('This student is still taking the exam');
    }

    const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
    // Only the questions this student was given (a question pool gives each student a subset).
    const given = new Set(attempt.questionOrder as string[]);
    const asked = exam.questions.filter((q) => given.has(q.id));
    const sharing = attempt.deviceId
      ? await this.prisma.attempt.findMany({
          where: { examId: exam.id, deviceId: attempt.deviceId, id: { not: attempt.id } },
          select: { student: { select: { name: true, email: true } } },
        })
      : [];
    const integrity = {
      startIp: attempt.startIp,
      lastIp: attempt.lastIp,
      userAgent: attempt.userAgent,
      hasDeviceId: Boolean(attempt.deviceId),
      sharedWith: sharing.map((x) => x.student),
      flags: integrityFlags({
        hasDeviceId: Boolean(attempt.deviceId),
        sharedDeviceCount: sharing.length,
        mismatchEvents: attempt.events.filter((e) => e.type === 'DEVICE_MISMATCH').length,
        startIp: attempt.startIp,
        lastIp: attempt.lastIp,
      }),
    };
    return {
      attemptId: attempt.id,
      examId: exam.id,
      studentName: attempt.student.name,
      studentEmail: attempt.student.email,
      status: attempt.status,
      endReason: attempt.endReason,
      strikes: attempt.strikes,
      events: attempt.events.map((e) => ({
        type: e.type,
        strike: e.strike,
        at: e.createdAt.toISOString(),
        ip: e.ip,
      })),
      history: await this.history(attempt.id),
      integrity,
      finalized: exam.status === 'RESULTS_FINAL',
      result:
        attempt.score !== null
          ? {
              score: attempt.score,
              maxScore: attempt.maxScore ?? 0,
              percent: attempt.percent ?? 0,
              passed: Boolean(attempt.passed),
            }
          : null,
      questions: asked.map((q, i) => {
        const a = byQuestion.get(q.id);
        const written = q.type === 'SUBJECTIVE';
        const blankWritten = written && !a?.text?.trim();
        return {
          questionId: q.id,
          number: i + 1,
          type: q.type,
          body: q.body,
          markdown: q.markdown,
          imageAlt: q.imageAlt,
          options: q.options,
          correctOptions: q.correctOptions,
          marks: q.marks,
          explanation: q.explanation,
          rubric: q.rubric,
          selected: a?.selected ?? [],
          text: a?.text ?? null,
          // null means "still waiting for the trainer"; a blank written answer is simply 0.
          marksAwarded: a?.marksAwarded ?? (!written || blankWritten ? 0 : null),
          feedback: a?.feedback ?? null,
          override:
            a?.marksOverride != null
              ? { marks: a.marksOverride, reason: a.overrideReason ?? '' }
              : null,
        };
      }),
    };
  }

  /** Time added, reopenings and device releases for one attempt, from the audit log. */
  private async history(attemptId: string): Promise<AttemptHistoryDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entity: 'Attempt',
        entityId: attemptId,
        action: {
          in: [
            'attempt.add_time',
            'attempt.reopen',
            'attempt.device.release',
            'attempt.device.auto_release',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const kinds: Record<string, AttemptHistoryDto['action']> = {
      'attempt.add_time': 'ADD_TIME',
      'attempt.reopen': 'REOPEN',
      'attempt.device.release': 'DEVICE_RELEASED',
      'attempt.device.auto_release': 'DEVICE_AUTO_RELEASED',
    };
    return rows.map((r) => {
      const meta = (r.meta ?? {}) as { reason?: string; minutes?: number };
      return {
        action: kinds[r.action],
        at: r.createdAt.toISOString(),
        reason: meta.reason ?? null,
        minutes: meta.minutes ?? null,
      };
    });
  }

  async gradeAnswer(
    user: AuthUser,
    examId: string,
    attemptId: string,
    questionId: string,
    input: GradeAnswerInput,
  ): Promise<{ saved: true }> {
    const exam = await this.findOwned(user, examId);
    if (exam.status === 'RESULTS_FINAL') {
      throw new ConflictException('Results are published, so marks can no longer change');
    }
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question || question.type !== 'SUBJECTIVE') {
      throw new NotFoundException('Question not found');
    }
    if (input.marks > question.marks) {
      throw new ConflictException(`Marks cannot be more than ${question.marks}`);
    }
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({ where: { id: attemptId, examId: exam.id } })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!(attempt.questionOrder as string[]).includes(questionId)) {
      throw new NotFoundException('Question not found');
    }
    if (attempt.status === 'IN_PROGRESS') {
      throw new ConflictException('This student is still taking the exam');
    }
    if (attempt.status === 'RESULT_PUBLISHED') {
      throw new ConflictException('This student has already been emailed their results');
    }
    const answer = await this.prisma.answer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    if (!answer?.text?.trim()) throw new ConflictException('There is no written answer to mark');

    await this.prisma.answer.update({
      where: { id: answer.id },
      data: { marksAwarded: input.marks, feedback: input.feedback ?? null, gradedAt: new Date() },
    });
    await this.grading.gradeAttempt(attemptId);
    // Always-open exam: the student's result goes out the moment their last answer is marked.
    if (exam.alwaysOpen) {
      this.delivery.deliverIfObjective(attemptId).catch((err: Error) => {
        this.logger.warn(`Release for attempt ${attemptId} failed: ${err.message}`);
      });
    }
    await this.audit.log({
      actorId: user.id,
      action: 'answer.grade',
      entity: 'Answer',
      entityId: answer.id,
      meta: { marks: input.marks },
    });
    return { saved: true };
  }

  /** Publishes results to students. Needs every written answer marked and the exam closed. */
  async finalize(user: AuthUser, examId: string): Promise<ExamResultsDto> {
    const exam = await this.findOwned(user, examId);
    if (exam.status === 'RESULTS_FINAL') {
      throw new ConflictException('Results are already published');
    }
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException('This exam has not been published');
    }
    if (exam.alwaysOpen) {
      throw new ConflictException(
        'An always-open exam has no results to publish: each result is released when it is marked.',
      );
    }
    if (exam.endsAt && exam.endsAt > new Date()) {
      throw new ConflictException(
        'The exam is still open until ' +
          exam.endsAt.toISOString() +
          '; publish results after it closes',
      );
    }
    await this.refresh(exam.id);

    const live = await this.prisma.attempt.count({
      where: { examId: exam.id, status: 'IN_PROGRESS' },
    });
    if (live > 0) throw new ConflictException(live + ' student(s) are still taking the exam');

    const unmarked = await this.prisma.attempt.count({
      where: { examId: exam.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
    });
    if (unmarked > 0) {
      throw new ConflictException(
        unmarked + ' attempt(s) still have written answers to mark before results can be published',
      );
    }

    // Only the call that flips PUBLISHED -> RESULTS_FINAL goes on to send emails and certificates.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const won = await tx.exam.updateMany({
        where: { id: exam.id, status: 'PUBLISHED' },
        data: { status: 'RESULTS_FINAL', resultsPublishedAt: new Date() },
      });
      if (won.count === 0) return false;
      await tx.attempt.updateMany({
        where: { examId: exam.id, status: 'GRADED' },
        data: { status: 'RESULT_PUBLISHED' },
      });
      return true;
    });
    if (!claimed) throw new ConflictException('Results are already published');
    await this.audit.log({
      actorId: user.id,
      action: 'exam.results.publish',
      entity: 'Exam',
      entityId: exam.id,
    });
    // One email per student: score, certificate (if the exam gives one) and answer sheet. Anyone
    // already emailed (their marking finished earlier) is skipped. A mail problem must never undo
    // the publication; whoever could not be reached is retried in the background.
    try {
      await this.delivery.deliverExam(exam.id);
    } catch (err) {
      console.error('Could not send results emails for exam', exam.id, err);
    }
    // The trainer's own certificate (and any student certificate that could not be sent above).
    try {
      await this.certificates.createForExam(exam.id);
    } catch (err) {
      console.error('Could not create certificates for exam', exam.id, err);
    }
    return this.results(user, examId);
  }

  /** Total marks for the exam. */
  private totalFor(exam: { questions: { marks: number }[] }) {
    return round2(exam.questions.reduce((s, q) => s + q.marks, 0));
  }

  /** Lets a student continue a running attempt from a different device. */
  async releaseDevice(
    user: AuthUser,
    examId: string,
    attemptId: string,
  ): Promise<{ released: true }> {
    const exam = await this.findOwned(user, examId);
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({ where: { id: attemptId, examId: exam.id } })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException('This attempt has already ended');
    }
    await this.prisma.attempt.update({ where: { id: attempt.id }, data: { deviceId: null } });
    await this.audit.log({
      actorId: user.id,
      action: 'attempt.device.release',
      entity: 'Attempt',
      entityId: attempt.id,
    });
    return { released: true };
  }

  async csv(user: AuthUser, examId: string): Promise<{ filename: string; body: string }> {
    const data = await this.results(user, examId);
    const header = [
      'Name',
      'Email',
      'Status',
      'Submitted at',
      'Score',
      'Out of',
      'Percent',
      'Result',
      'Strikes',
      'Violations',
      'Ended by',
    ];
    const lines = data.rows.map((r) =>
      [
        r.studentName,
        r.studentEmail,
        r.status,
        r.submittedAt,
        r.score,
        r.maxScore,
        r.percent,
        r.passed === null ? '' : r.passed ? 'Pass' : 'Fail',
        r.strikes,
        r.violations,
        r.endReason,
      ]
        .map(csvCell)
        .join(','),
    );
    const slug = data.exam.title
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return {
      filename: (slug || 'exam') + '-results.csv',
      body: [header.join(','), ...lines].join('\r\n') + '\r\n',
    };
  }

  // ---------------------------------------------------------------- student

  async studentResult(user: AuthUser, attemptId: string): Promise<StudentResultDto> {
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({
          where: { id: attemptId, studentId: user.id },
          include: {
            answers: true,
            exam: { include: { questions: true } },
          },
        })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status !== 'RESULT_PUBLISHED' || attempt.score === null) {
      throw new ConflictException('Results have not been published yet');
    }
    return toStudentResult(attempt);
  }
}

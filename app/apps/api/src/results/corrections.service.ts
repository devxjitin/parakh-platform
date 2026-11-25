import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CorrectionResultDto, OverrideMarksInput } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from './grading.service';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One-off marks for a student's answer. A published exam itself (wording, answer key, questions)
 * cannot be changed. Works only until results are published and is audited with before and after.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grading: GradingService,
  ) {}

  private async load(user: AuthUser, examId: string, questionId?: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({ where: { id: examId, examinerId: user.id } })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException(
        exam.status === 'DRAFT'
          ? 'Edit a draft exam directly'
          : 'Results are published or the exam was cancelled, so it can no longer change',
      );
    }
    if (!questionId) return { exam, question: null };
    const question = UUID.test(questionId)
      ? await this.prisma.question.findFirst({ where: { id: questionId, examId: exam.id } })
      : null;
    if (!question) throw new NotFoundException('Question not found');
    return { exam, question };
  }

  async overrideMarks(
    user: AuthUser,
    examId: string,
    attemptId: string,
    questionId: string,
    input: OverrideMarksInput,
  ): Promise<CorrectionResultDto> {
    const { exam, question } = await this.load(user, examId, questionId);
    const q = question!;
    if (q.type !== 'SINGLE' && q.type !== 'MULTI') {
      throw new ConflictException('Written answers are marked on the marking page');
    }
    if (input.marks !== null && input.marks > q.marks) {
      throw new ConflictException(`Marks cannot be more than ${q.marks}`);
    }
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({ where: { id: attemptId, examId: exam.id } })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!(attempt.questionOrder as string[]).includes(q.id))
      throw new NotFoundException('Question not found');
    if (attempt.status === 'IN_PROGRESS') {
      throw new ConflictException('This student is still taking the exam');
    }
    // The student already has this score by email (and a certificate hashed from it). Changing
    // it now would leave two different "true" results.
    if (attempt.resultEmailedAt || attempt.status === 'RESULT_PUBLISHED') {
      throw new ConflictException(
        'This result has already been sent to the student, so the marks can no longer be changed',
      );
    }
    const before = await this.prisma.answer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId: q.id } },
    });
    await this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: q.id } },
      create: {
        attemptId,
        questionId: q.id,
        selected: [],
        marksOverride: input.marks,
        overrideReason: input.marks === null ? null : (input.reason ?? null),
      },
      update: {
        marksOverride: input.marks,
        overrideReason: input.marks === null ? null : (input.reason ?? null),
      },
    });
    await this.grading.gradeAttempt(attemptId);
    await this.audit.log({
      actorId: user.id,
      action: 'answer.override_marks',
      entity: 'Answer',
      entityId: before?.id ?? attemptId,
      meta: {
        examId: exam.id,
        questionId: q.id,
        reason: input.reason,
        before: before?.marksOverride ?? null,
        after: input.marks,
      },
    });
    return { regraded: 1 };
  }
}

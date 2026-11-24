import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AnswerKeyInput,
  CorrectionResultDto,
  CorrectQuestionInput,
  DropQuestionInput,
  OverrideMarksInput,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from './grading.service';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Fixes to a published exam: wording, answer key, dropping a question and one-off marks. All of
 * them work only until results are published, and every change is audited with before and after.
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

  /** Marks every finished attempt again. Students still sitting are marked when they submit. */
  private async regradeAll(examId: string): Promise<number> {
    const attempts = await this.prisma.attempt.findMany({
      where: { examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'GRADED'] } },
      select: { id: true },
    });
    for (const a of attempts) await this.grading.gradeAttempt(a.id);
    return attempts.length;
  }

  async correctText(
    user: AuthUser,
    examId: string,
    questionId: string,
    input: CorrectQuestionInput,
  ): Promise<CorrectionResultDto> {
    const { exam, question } = await this.load(user, examId, questionId);
    const q = question!;
    if (input.options && input.options.length !== q.options.length) {
      throw new ConflictException('Options cannot be added or removed after publishing');
    }
    if (input.options && q.type !== 'SINGLE' && q.type !== 'MULTI') {
      throw new ConflictException('This question has no options');
    }
    const data = {
      body: input.body,
      options: input.options,
      explanation: input.explanation,
      rubric: input.rubric,
      revision: { increment: 1 },
    };
    await this.prisma.question.update({ where: { id: q.id }, data });
    await this.audit.log({
      actorId: user.id,
      action: 'question.correct_text',
      entity: 'Question',
      entityId: q.id,
      meta: {
        examId: exam.id,
        reason: input.reason,
        before: { body: q.body, options: q.options, explanation: q.explanation, rubric: q.rubric },
        after: input,
      },
    });
    return { regraded: 0 };
  }

  async setAnswerKey(
    user: AuthUser,
    examId: string,
    questionId: string,
    input: AnswerKeyInput,
  ): Promise<CorrectionResultDto> {
    const { exam, question } = await this.load(user, examId, questionId);
    const q = question!;
    if (q.type !== 'SINGLE' && q.type !== 'MULTI') {
      throw new ConflictException('Only choice questions have an answer key');
    }
    const picks = [...new Set(input.correctOptions)].sort((a, b) => a - b);
    if (picks.some((i) => i >= q.options.length))
      throw new ConflictException('That option does not exist');
    if (q.type === 'SINGLE' && picks.length !== 1) {
      throw new ConflictException('A single-answer question has exactly one correct option');
    }
    await this.prisma.question.update({
      where: { id: q.id },
      data: {
        correctOptions: picks,
        partialCredit: q.type === 'MULTI' ? (input.partialCredit ?? q.partialCredit) : false,
        revision: { increment: 1 },
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'question.correct_key',
      entity: 'Question',
      entityId: q.id,
      meta: {
        examId: exam.id,
        reason: input.reason,
        before: { correctOptions: q.correctOptions, partialCredit: q.partialCredit },
        after: { correctOptions: picks, partialCredit: input.partialCredit },
      },
    });
    return { regraded: await this.regradeAll(exam.id) };
  }

  async setDropped(
    user: AuthUser,
    examId: string,
    questionId: string,
    input: DropQuestionInput,
  ): Promise<CorrectionResultDto> {
    const { exam, question } = await this.load(user, examId, questionId);
    const q = question!;
    if (input.dropped === (q.droppedAt !== null)) {
      throw new ConflictException(
        input.dropped ? 'Already dropped' : 'This question is not dropped',
      );
    }
    await this.prisma.question.update({
      where: { id: q.id },
      data: { droppedAt: input.dropped ? new Date() : null, revision: { increment: 1 } },
    });
    await this.audit.log({
      actorId: user.id,
      action: input.dropped ? 'question.drop' : 'question.restore',
      entity: 'Question',
      entityId: q.id,
      meta: { examId: exam.id, reason: input.reason },
    });
    return { regraded: await this.regradeAll(exam.id) };
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

import { Injectable } from '@nestjs/common';
import { gradeChoice, summarize } from '@parakh/shared';
import type { Attempt } from '@prisma/client';
import { GRACE_MS } from '../common/timing';
import { PrismaService } from '../prisma/prisma.service';

/** Scores attempts. Choice questions are marked by the server; subjective ones wait for the trainer. */
@Injectable()
export class GradingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks every choice answer of a finished attempt and, once nothing is waiting for the
   * trainer, stores the total. Safe to call again at any time; it never touches an attempt
   * whose results have been published, or the marks a trainer has already given.
   */
  async gradeAttempt(attemptId: string): Promise<void> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { answers: true, exam: { include: { questions: true } } },
    });
    if (!attempt || attempt.status === 'IN_PROGRESS' || attempt.status === 'RESULT_PUBLISHED') {
      return;
    }
    const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const now = new Date();
    const writes = [];
    const awarded: number[] = [];
    let pending = 0;

    // Only the questions this student was given count.
    const given = new Set(attempt.questionOrder as string[]);
    const questions = attempt.exam.questions.filter((q) => given.has(q.id));

    for (const q of questions) {
      const a = byQuestion.get(q.id);
      if (q.type === 'SUBJECTIVE') {
        if (!a?.text?.trim()) {
          awarded.push(0); // left blank: nothing to read, nothing to award
        } else if (a.marksAwarded === null) {
          pending++;
        } else {
          awarded.push(a.marksAwarded);
        }
        continue;
      }
      const g = gradeChoice(
        {
          type: q.type,
          correctOptions: q.correctOptions,
          marks: q.marks,
          partialCredit: q.partialCredit,
        },
        a?.selected ?? [],
      );
      // A mark the trainer set by hand wins over the automatic one.
      const marks = a?.marksOverride ?? g.marks;
      awarded.push(marks);
      if (a && a.marksAwarded !== marks) {
        writes.push(
          this.prisma.answer.update({
            where: { id: a.id },
            data: { marksAwarded: marks, gradedAt: now },
          }),
        );
      }
    }

    if (pending === 0) {
      const maxScore = questions.reduce((s, q) => s + q.marks, 0);
      const result = summarize({ awarded, maxScore, passPercent: attempt.exam.passPercent });
      writes.push(
        this.prisma.attempt.update({
          where: { id: attempt.id },
          data: { ...result, gradedAt: now, status: 'GRADED' },
        }),
      );
    } else {
      writes.push(
        this.prisma.attempt.update({
          where: { id: attempt.id },
          data: { score: null, maxScore: null, percent: null, passed: null, gradedAt: null },
        }),
      );
    }
    await this.prisma.$transaction(writes);
  }

  /** The deadline may have changed since a reader or the sweeper found this attempt overdue. */
  async settleExpired(attempt: Pick<Attempt, 'id' | 'deadlineAt'>): Promise<boolean> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const flipped = await this.prisma.attempt.updateMany({
      where: {
        id: attempt.id,
        status: 'IN_PROGRESS',
        deadlineAt: { equals: attempt.deadlineAt, lte: cutoff },
      },
      data: { status: 'AUTO_SUBMITTED', endReason: 'TIME_UP', submittedAt: attempt.deadlineAt },
    });
    if (!flipped.count) return false;
    await this.gradeAttempt(attempt.id);
    return true;
  }

  /**
   * Ends attempts whose time ran out without anyone opening them again, then marks them. Students
   * who simply closed the tab would otherwise stay "in progress" for ever.
   */
  async settleOverdue(examId: string): Promise<number> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const overdue = await this.prisma.attempt.findMany({
      where: { examId, status: 'IN_PROGRESS', deadlineAt: { lt: cutoff } },
    });
    let ended = 0;
    for (const attempt of overdue) {
      if (await this.settleExpired(attempt)) ended++;
    }
    return ended;
  }
}

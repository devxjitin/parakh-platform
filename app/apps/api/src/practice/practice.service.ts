import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Exam, Question } from '@prisma/client';
import {
  PRACTICE,
  gradeChoice,
  summarize,
  type PracticeCheckInput,
  type PracticeFeedbackDto,
  type PracticeQuestionDto,
  type PracticeRoundDto,
  type PracticeSetDto,
  type PracticeSubmitInput,
  type PracticeSummaryDto,
} from '@parakh/shared';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../results/grading.service';
import { readPrivateImage } from '../storage/private-image';
import { STORAGE, Storage } from '../storage/storage.service';

const UUID = /^[0-9a-f-]{36}$/i;
const OVER = ['RESULTS_FINAL', 'CANCELLED'];

const DAY_MS = 86_400_000;

/**
 * Practice sets. A student who took an exam can practise its questions once the exam is over
 * (so answers cannot leak to people still sitting it). Nothing here touches official attempts.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  private isOver(exam: Pick<Exam, 'status' | 'endsAt' | 'alwaysOpen'>): boolean {
    // An always-open exam never closes: it is the practice, so there is no after-exam practice set.
    if (exam.alwaysOpen) return false;
    if (OVER.includes(exam.status)) return true;
    return (
      exam.status === 'PUBLISHED' && exam.endsAt !== null && exam.endsAt.getTime() <= Date.now()
    );
  }

  /** When the exam closed: its end time, or else when results came out. */
  private closedAt(exam: Pick<Exam, 'endsAt' | 'resultsPublishedAt' | 'updatedAt'>): Date {
    return exam.endsAt ?? exam.resultsPublishedAt ?? exam.updatedAt;
  }

  private expiresAt(exam: Pick<Exam, 'endsAt' | 'resultsPublishedAt' | 'updatedAt'>): Date {
    return new Date(this.closedAt(exam).getTime() + PRACTICE.EXPIRY_DAYS * DAY_MS);
  }

  /** 403 unless the exam is over and this student handed in an attempt. */
  private async unlock(user: AuthUser, examId: string) {
    if (!UUID.test(examId)) throw new NotFoundException('Practice set not found');
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!exam) throw new NotFoundException('Practice set not found');
    if (!this.isOver(exam)) {
      throw new ForbiddenException('Practice opens after the exam has closed');
    }
    if (this.expiresAt(exam).getTime() <= Date.now()) {
      throw new ForbiddenException(
        `This practice set expired ${PRACTICE.EXPIRY_DAYS} days after the exam closed`,
      );
    }
    // Students who closed the tab are still "in progress" until someone settles them.
    await this.grading.settleOverdue(examId);
    const took = await this.prisma.attempt.findFirst({
      where: { examId, studentId: user.id, status: { not: 'IN_PROGRESS' } },
      select: { id: true },
    });
    if (!took) {
      throw new ForbiddenException('Practice is only for students who took this exam');
    }
    await this.prisma.practiceAccess.upsert({
      where: { studentId_examId: { studentId: user.id, examId } },
      create: { studentId: user.id, examId },
      update: {},
    });
    return exam;
  }

  // ------------------------------------------------------------------- listing

  async mine(user: AuthUser): Promise<PracticeSummaryDto[]> {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId: user.id, status: { not: 'IN_PROGRESS' } },
      include: {
        exam: {
          include: {
            examiner: { select: { name: true } },
            questions: { select: { type: true } },
          },
        },
      },
    });
    const open = attempts.filter(
      (a) => this.isOver(a.exam) && this.expiresAt(a.exam).getTime() > Date.now(),
    );
    if (open.length === 0) return [];
    const rounds = await this.prisma.practiceRound.groupBy({
      by: ['examId'],
      where: { studentId: user.id, examId: { in: open.map((a) => a.examId) } },
      _count: { _all: true },
      _max: { percent: true, createdAt: true },
    });
    const byExam = new Map(rounds.map((r) => [r.examId, r]));
    return open
      .map((a) => {
        const r = byExam.get(a.examId);
        return {
          examId: a.examId,
          title: a.exam.title,
          trainerName: a.exam.examiner.name,
          questionCount: a.exam.questions.length,
          scoredCount: a.exam.questions.filter((q) => q.type === 'SINGLE' || q.type === 'MULTI')
            .length,
          rounds: r?._count._all ?? 0,
          bestPercent: r?._max.percent ?? null,
          lastRoundAt: r?._max.createdAt?.toISOString() ?? null,
          expiresAt: this.expiresAt(a.exam).toISOString(),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // --------------------------------------------------------------------- the set

  async set(user: AuthUser, examId: string): Promise<PracticeSetDto> {
    const exam = await this.unlock(user, examId);
    return {
      examId,
      title: exam.title,
      expiresAt: this.expiresAt(exam).toISOString(),
      questions: exam.questions.map((q, i) => this.toDto(q, i + 1)),
    };
  }

  async questionImage(user: AuthUser, examId: string, questionId: string) {
    const exam = await this.unlock(user, examId);
    return readPrivateImage(
      this.storage,
      exam.questions.find((q) => q.id === questionId)?.imageKey,
    );
  }

  private toDto(q: Question, number: number): PracticeQuestionDto {
    return {
      id: q.id,
      number,
      type: q.type,
      body: q.body,
      markdown: q.markdown,
      imageAlt: q.imageAlt,
      marks: q.marks,
      options: q.options,
    };
  }

  // ------------------------------------------------------------ instant feedback

  async check(
    user: AuthUser,
    examId: string,
    questionId: string,
    input: PracticeCheckInput,
  ): Promise<PracticeFeedbackDto> {
    const exam = await this.unlock(user, examId);
    const q = UUID.test(questionId) ? exam.questions.find((x) => x.id === questionId) : undefined;
    if (!q) throw new NotFoundException('Question not found');
    const type = q.type;

    const base = {
      questionId: q.id,
      type,
      maxMarks: q.marks,
      explanation: q.explanation,
    };

    if (type === 'SINGLE' || type === 'MULTI') {
      const g = gradeChoice(
        {
          type,
          correctOptions: q.correctOptions,
          marks: q.marks,
          partialCredit: q.partialCredit,
        },
        input.selected ?? [],
      );
      return {
        ...base,
        correct: g.outcome === 'UNANSWERED' ? false : g.outcome === 'CORRECT',
        marks: g.marks,
        correctOptions: q.correctOptions,
        guidance: null,
      };
    }

    // Written answers receive guidance. Only choice questions are scored.
    return { ...base, correct: null, marks: null, correctOptions: [], guidance: q.rubric };
  }

  // ------------------------------------------------------------------ rounds

  /** Scores a round of choice answers and keeps it in the history. */
  async submit(
    user: AuthUser,
    examId: string,
    input: PracticeSubmitInput,
  ): Promise<PracticeRoundDto> {
    const exam = await this.unlock(user, examId);
    const scored = exam.questions.filter((q) => q.type === 'SINGLE' || q.type === 'MULTI');
    if (scored.length === 0) {
      throw new ConflictException('This set has no choice questions to score');
    }
    const number = new Map(exam.questions.map((q, i) => [q.id, i + 1]));
    const awarded: number[] = [];
    const results: PracticeRoundDto['results'] = [];
    let answered = 0;
    for (const q of scored) {
      const selected = input.answers[q.id] ?? [];
      if (selected.length > 0) answered++;
      const g = gradeChoice(
        {
          type: q.type as 'SINGLE' | 'MULTI',
          correctOptions: q.correctOptions,
          marks: q.marks,
          partialCredit: q.partialCredit,
        },
        selected,
      );
      awarded.push(g.marks);
      results.push({
        questionId: q.id,
        number: number.get(q.id) ?? 0,
        outcome: g.outcome,
        marks: g.marks,
      });
    }
    const total = summarize({
      awarded,
      maxScore: scored.reduce((s, q) => s + q.marks, 0),
      passPercent: exam.passPercent,
    });
    const row = await this.prisma.practiceRound.create({
      data: {
        studentId: user.id,
        examId,
        score: total.score,
        maxScore: total.maxScore,
        percent: total.percent,
        answered,
        scoredCount: scored.length,
        results,
      },
    });
    return this.toRound(row);
  }

  async history(user: AuthUser, examId: string): Promise<PracticeRoundDto[]> {
    await this.unlock(user, examId);
    const rows = await this.prisma.practiceRound.findMany({
      where: { studentId: user.id, examId },
      orderBy: { createdAt: 'desc' },
      take: PRACTICE.HISTORY_LIMIT,
    });
    return rows.map((r) => this.toRound(r));
  }

  private toRound(r: {
    id: string;
    score: number;
    maxScore: number;
    percent: number;
    answered: number;
    scoredCount: number;
    createdAt: Date;
    results: unknown;
  }): PracticeRoundDto {
    return {
      id: r.id,
      score: r.score,
      maxScore: r.maxScore,
      percent: r.percent,
      answered: r.answered,
      scoredCount: r.scoredCount,
      createdAt: r.createdAt.toISOString(),
      results: r.results as PracticeRoundDto['results'],
    };
  }
}

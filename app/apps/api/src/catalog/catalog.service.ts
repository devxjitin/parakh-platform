import { Injectable, NotFoundException } from '@nestjs/common';
import type { CatalogDto, CatalogExamDto } from '@parakh/shared';
import { examJoinFee, normalizeCode } from '../enrollments/join-state';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * The public "Available exams" list. It is built from the exams themselves, so publishing an
 * exam (or retiring it) is all it takes for the landing page and the app to follow. Only
 * descriptive facts leave here: never questions, options, answers or marking guidance.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async toDto(
    exam: {
      code: string | null;
      title: string;
      catalogSummary: string | null;
      description: string | null;
      catalogTopics: string[];
      catalogCategory: string;
      durationMinutes: number;
      passPercent: number;
      nandivexHosted: boolean;
      studentFeePaise: number | null;
      questions: { marks: number; type: string }[];
    },
    joinPaise: number,
  ): Promise<CatalogExamDto> {
    const total = exam.questions.reduce((s, q) => s + q.marks, 0);
    return {
      code: exam.code!,
      title: exam.title,
      summary: exam.catalogSummary ?? exam.description,
      topics: exam.catalogTopics,
      category: exam.catalogCategory,
      questionCount: exam.questions.length,
      totalMarks: Math.round(total * 100) / 100,
      durationMinutes: exam.durationMinutes,
      passPercent: exam.passPercent,
      feePaise: examJoinFee(exam, joinPaise),
      hasWrittenQuestions: exam.questions.some((q) => q.type === 'SUBJECTIVE'),
    };
  }

  private readonly select = {
    code: true,
    title: true,
    catalogSummary: true,
    description: true,
    catalogTopics: true,
    catalogCategory: true,
    durationMinutes: true,
    passPercent: true,
    nandivexHosted: true,
    studentFeePaise: true,
    questions: { select: { marks: true, type: true } },
  } as const;

  /** Published, always-open exams the admin chose to list, newest first. */
  async list(): Promise<CatalogDto> {
    const rows = await this.prisma.exam.findMany({
      where: { status: 'PUBLISHED', alwaysOpen: true, listedPublicly: true, code: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      select: this.select,
    });
    const joinPaise = (await this.settings.get()).examJoinPaise;
    return { exams: await Promise.all(rows.map((r) => this.toDto(r, joinPaise))) };
  }

  async one(rawCode: string): Promise<CatalogExamDto> {
    const exam = await this.prisma.exam.findFirst({
      where: {
        code: normalizeCode(rawCode),
        status: 'PUBLISHED',
        alwaysOpen: true,
        listedPublicly: true,
      },
      select: this.select,
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return this.toDto(exam, (await this.settings.get()).examJoinPaise);
  }
}

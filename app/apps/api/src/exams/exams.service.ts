import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Exam, Prisma, Question } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CERT_TEMPLATE,
  certificateTemplateSchema,
  paperPlanSchema,
  planMarksFor,
  LIMITS,
  parseAiPaper,
  planParts,
  type AiBrief,
  type AiImportInput,
  type AiImportResult,
  type CreateExamInput,
  type ExamDetailDto,
  type ExamPreviewDto,
  type ExamQuestionDto,
  type ExamSummaryDto,
  type ImportQuestionsInput,
  type QuestionInput,
  type UpdateExamInput,
} from '@parakh/shared';
import { parseQuestionsTxt, type ParsedQuestion } from '@parakh/question-parser';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { readPrivateImage, validateImage } from '../storage/private-image';
import { STORAGE, Storage } from '../storage/storage.service';

type ExamWithQuestions = Exam & { questions: Question[] };

/** When an exam that opens at `startsAt` and lasts `minutes` closes. */
function closingTime(startsAt: Date, minutes: number): Date {
  return new Date(startsAt.getTime() + minutes * 60_000);
}

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  // ------------------------------------------------------------------ exams

  async create(user: AuthUser, input: CreateExamInput): Promise<ExamDetailDto> {
    const isAdmin = user.role === 'ADMIN';
    const alwaysOpen = input.alwaysOpen ?? false;
    if (!isAdmin && (alwaysOpen || input.catalogTopics?.length)) {
      throw new BadRequestException('Only NandiVex can make an always-open exam');
    }
    // An always-open exam must be filed under one of the categories an admin created.
    const catalogCategory = alwaysOpen
      ? await this.categories.resolve(input.catalogCategory ?? '')
      : '';
    const exam = await this.prisma.exam.create({
      data: {
        examinerId: user.id,
        // An admin's exam is run by NandiVex itself: no creation fee, no trainer share, and the
        // admin sets what students pay.
        nandivexHosted: user.role === 'ADMIN',
        studentFeePaise: user.role === 'ADMIN' ? (input.studentFeePaise ?? null) : null,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        durationMinutes: input.durationMinutes,
        alwaysOpen,
        // Every always-open exam is on the public list once it is published.
        listedPublicly: alwaysOpen,
        catalogSummary: isAdmin ? (input.catalogSummary ?? null) : null,
        catalogTopics: isAdmin ? (input.catalogTopics ?? []) : [],
        catalogCategory,
        // An always-open exam has no window at all.
        startsAt: !alwaysOpen && input.startsAt ? new Date(input.startsAt) : null,
        // The exam closes when its time is up: the opening time plus the duration. An explicit
        // closing time (older clients, tests) is still honoured.
        endsAt: alwaysOpen
          ? null
          : input.endsAt
            ? new Date(input.endsAt)
            : input.startsAt
              ? closingTime(new Date(input.startsAt), input.durationMinutes)
              : null,
        passPercent: input.passPercent,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
        strikePolicy: input.strikePolicy,
        maxStrikes: input.maxStrikes,
        certificate: {
          ...DEFAULT_CERT_TEMPLATE,
          enabled: input.certificatesEnabled,
        } as unknown as Prisma.InputJsonValue,
        paperPlan: input.paperPlan
          ? (input.paperPlan as unknown as Prisma.InputJsonValue)
          : undefined,
      },
      include: { questions: true },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'exam.create',
      entity: 'Exam',
      entityId: exam.id,
    });
    return this.toDetail(exam);
  }

  async list(user: AuthUser): Promise<ExamSummaryDto[]> {
    const exams = await this.prisma.exam.findMany({
      where: { examinerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { questions: { select: { marks: true } } },
    });
    const joined = await this.prisma.enrollment.groupBy({
      by: ['examId'],
      where: { exam: { examinerId: user.id } },
      _count: { _all: true },
    });
    const joinedOf = new Map(joined.map((j) => [j.examId, j._count._all]));
    return exams.map((e) => ({
      ...this.toSummary(e, e.questions),
      joinedCount: joinedOf.get(e.id) ?? 0,
    }));
  }

  async get(user: AuthUser, examId: string): Promise<ExamDetailDto> {
    return this.toDetail(await this.findOwned(user, examId));
  }

  /**
   * A new draft with the same settings, questions and certificate design. It has no code, no
   * payment and no dates (a new window is needed to publish), and does not share the logo file.
   */
  async duplicate(user: AuthUser, examId: string): Promise<ExamDetailDto> {
    const source = await this.findOwned(user, examId);
    const copyId = randomUUID();
    const imageCopies = new Map<string, string>();
    let copy: ExamWithQuestions;
    try {
      for (const q of source.questions) {
        if (q.imageKey) {
          const file = await readPrivateImage(this.storage, q.imageKey);
          imageCopies.set(q.id, await this.storeQuestionImage(copyId, file.body));
        }
      }
      copy = await this.prisma.exam.create({
        data: {
          id: copyId,
          examinerId: user.id,
          nandivexHosted: source.nandivexHosted,
          studentFeePaise: source.studentFeePaise,
          alwaysOpen: source.alwaysOpen,
          catalogSummary: source.catalogSummary,
          catalogTopics: source.catalogTopics,
          catalogCategory: source.catalogCategory,
          title: `Copy of ${source.title}`.slice(0, 200),
          description: source.description,
          instructions: source.instructions,
          durationMinutes: source.durationMinutes,
          passPercent: source.passPercent,
          shuffleQuestions: source.shuffleQuestions,
          shuffleOptions: source.shuffleOptions,
          strikePolicy: source.strikePolicy,
          maxStrikes: source.maxStrikes,
          certificate: (source.certificate ?? undefined) as Prisma.InputJsonValue | undefined,
          aiBrief: (source.aiBrief ?? undefined) as Prisma.InputJsonValue | undefined,
          questions: {
            create: source.questions.map((q) => ({
              position: q.position,
              type: q.type,
              body: q.body,
              markdown: q.markdown,
              imageKey: imageCopies.get(q.id),
              imageAlt: q.imageAlt,
              options: q.options,
              correctOptions: q.correctOptions,
              marks: q.marks,
              partialCredit: q.partialCredit,
              explanation: q.explanation,
              rubric: q.rubric,
            })),
          },
        },
        include: { questions: { orderBy: { position: 'asc' } } },
      });
    } catch (err) {
      await Promise.all([...imageCopies.values()].map((key) => this.deleteQuestionImage(key)));
      throw err;
    }
    await this.audit.log({
      actorId: user.id,
      action: 'exam.duplicate',
      entity: 'Exam',
      entityId: copy.id,
      meta: { from: source.id },
    });
    return this.toDetail(copy);
  }

  async update(user: AuthUser, examId: string, input: UpdateExamInput): Promise<ExamDetailDto> {
    const exam = await this.findOwned(user, examId);
    // Once an exam is published nothing about it can change: not its questions, settings, times
    // or the card students see in the exam list.
    this.assertDraft(exam);
    if (input.studentFeePaise !== undefined && !exam.nandivexHosted) {
      throw new BadRequestException('Only NandiVex-run exams have a custom student fee');
    }
    const touchesCatalog =
      input.alwaysOpen !== undefined ||
      input.catalogSummary !== undefined ||
      input.catalogTopics !== undefined ||
      input.catalogCategory !== undefined;
    if (touchesCatalog && !exam.nandivexHosted) {
      throw new BadRequestException('Only NandiVex-run exams can be always open');
    }
    if (input.alwaysOpen !== undefined && input.alwaysOpen !== exam.alwaysOpen) {
      throw new BadRequestException(
        'An exam is either always open or scheduled. Create a new exam to change that.',
      );
    }
    const alwaysOpen = exam.alwaysOpen;
    if (
      !alwaysOpen &&
      (input.catalogSummary || input.catalogTopics?.length || input.catalogCategory)
    ) {
      throw new BadRequestException('Only an always-open exam appears in the exam list');
    }
    // An always-open exam always stays filed under one of the admin's categories.
    const catalogCategory =
      alwaysOpen && input.catalogCategory !== undefined
        ? await this.categories.resolve(input.catalogCategory)
        : undefined;
    // The list card always needs its summary and topics.
    const missing: Record<string, string[]> = {};
    if (alwaysOpen && input.catalogSummary !== undefined && !input.catalogSummary?.trim()) {
      missing.catalogSummary = ['Write a short summary students will see in the exam list'];
    }
    if (alwaysOpen && input.catalogTopics !== undefined && input.catalogTopics.length === 0) {
      missing.catalogTopics = ['Add at least one topic'];
    }
    if (Object.keys(missing).length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: missing,
      });
    }

    // The window rule also has to hold against values that were not part of this request.
    const startsAt = alwaysOpen
      ? null
      : input.startsAt === undefined
        ? exam.startsAt
        : input.startsAt
          ? new Date(input.startsAt)
          : null;
    const durationMinutes = input.durationMinutes ?? exam.durationMinutes;
    let endsAt = alwaysOpen
      ? null
      : input.endsAt === undefined
        ? exam.endsAt
        : input.endsAt
          ? new Date(input.endsAt)
          : null;
    // The closing time follows the start and duration (closes when its time is up) unless the
    // trainer set a later one of their own. Sending null asks for the automatic closing again.
    const timingChanged = input.startsAt !== undefined || input.durationMinutes !== undefined;
    const wasAutomatic =
      !exam.startsAt ||
      !exam.endsAt ||
      exam.endsAt.getTime() === closingTime(exam.startsAt, exam.durationMinutes).getTime();
    const followStart =
      input.endsAt === null || (input.endsAt === undefined && timingChanged && wasAutomatic);
    if (!alwaysOpen && followStart) {
      endsAt = startsAt ? closingTime(startsAt, durationMinutes) : null;
    }
    // Switching to always open clears any window that was set before.
    const endsAtChanged =
      input.endsAt !== undefined || timingChanged || input.alwaysOpen !== undefined;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: { endsAt: ['The end time must be after the start time'] },
      });
    }

    const plan = input.paperPlan ? paperPlanSchema.safeParse(input.paperPlan).data : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      // The paper plan owns the marks of each question type: when the plan changes, the questions
      // already added follow it, so the exam total always matches the plan.
      if (plan) {
        for (const type of ['SINGLE', 'MULTI', 'SUBJECTIVE'] as const) {
          const marks = planMarksFor(plan, type);
          if (marks > 0) await tx.question.updateMany({ where: { examId, type }, data: { marks } });
        }
      }
      return tx.exam.update({
        where: { id: examId },
        data: {
          title: input.title,
          description: input.description,
          instructions: input.instructions,
          durationMinutes: input.durationMinutes,
          startsAt:
            input.startsAt === undefined && input.alwaysOpen === undefined ? undefined : startsAt,
          endsAt: endsAtChanged ? endsAt : undefined,
          alwaysOpen: input.alwaysOpen,
          catalogSummary: input.catalogSummary,
          catalogTopics: input.catalogTopics,
          catalogCategory,
          passPercent: input.passPercent,
          shuffleQuestions: input.shuffleQuestions,
          shuffleOptions: input.shuffleOptions,
          strikePolicy: input.strikePolicy,
          maxStrikes: input.maxStrikes,
          studentFeePaise: input.studentFeePaise,
          paperPlan: input.paperPlan
            ? (input.paperPlan as unknown as Prisma.InputJsonValue)
            : undefined,
        },
        include: { questions: { orderBy: { position: 'asc' } } },
      });
    });
    await this.audit.log({
      actorId: user.id,
      action: 'exam.update',
      entity: 'Exam',
      entityId: examId,
    });
    return this.toDetail(updated);
  }

  async remove(user: AuthUser, examId: string): Promise<void> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, examId);
      const questions = await tx.question.findMany({
        where: { examId },
        select: { imageKey: true },
      });
      const deleted = await tx.exam.delete({ where: { id: examId } });
      return { questions, logoKey: deleted.logoKey };
    });
    await Promise.all(removed.questions.map((q) => this.deleteQuestionImage(q.imageKey)));
    if (removed.logoKey) await this.storage.delete(removed.logoKey);
    await this.audit.log({
      actorId: user.id,
      action: 'exam.delete',
      entity: 'Exam',
      entityId: examId,
    });
  }

  /** The exam exactly as a student will see it: no answers, explanations or rubrics. */
  async preview(user: AuthUser, examId: string): Promise<ExamPreviewDto> {
    const exam = await this.findOwned(user, examId);
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      totalMarks: this.totalMarks(exam.questions),
      passPercent: exam.passPercent,
      questions: exam.questions.map((q) => {
        const { correctOptions: _c, explanation: _e, rubric: _r, ...visible } = this.toQuestion(q);
        return visible;
      }),
    };
  }

  // -------------------------------------------------------------- questions

  async addQuestion(
    user: AuthUser,
    examId: string,
    input: QuestionInput,
    file?: Buffer,
  ): Promise<ExamQuestionDto> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    if (input.imageAlt && !file) throw new BadRequestException('Choose an image file');
    const imageKey = await this.prepareQuestionImage(examId, input, file);
    let created: Question;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.lockDraft(tx, examId);
        const count = await tx.question.count({ where: { examId } });
        this.assertRoom(count, 1);
        return tx.question.create({
          data: {
            examId,
            position: count + 1,
            ...this.questionData(input),
            imageKey,
            imageAlt: imageKey ? input.imageAlt : null,
          },
        });
      });
    } catch (err) {
      await this.deleteQuestionImage(imageKey);
      throw err;
    }
    await this.audit.log({
      actorId: user.id,
      action: 'question.create',
      entity: 'Question',
      entityId: created.id,
    });
    return this.toQuestion(created);
  }

  async updateQuestion(
    user: AuthUser,
    examId: string,
    questionId: string,
    input: QuestionInput,
    file?: Buffer,
  ): Promise<ExamQuestionDto> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    this.requireQuestion(exam, questionId);
    const imageKey = await this.prepareQuestionImage(examId, input, file);
    let updated: Question;
    let previousKey: string | null;
    try {
      ({ updated, previousKey } = await this.prisma.$transaction(async (tx) => {
        await this.lockDraft(tx, examId);
        const existing = await tx.question.findUnique({ where: { id: questionId } });
        if (!existing) throw new NotFoundException('Question not found');
        const key = input.imageAlt === null ? null : (imageKey ?? existing.imageKey);
        if (input.imageAlt && !key) throw new BadRequestException('Choose an image file');
        return {
          updated: await tx.question.update({
            where: { id: questionId },
            data: {
              ...this.questionData(input),
              imageKey: key,
              imageAlt: key ? (input.imageAlt ?? existing.imageAlt) : null,
            },
          }),
          previousKey: existing.imageKey,
        };
      }));
    } catch (err) {
      await this.deleteQuestionImage(imageKey);
      throw err;
    }
    if (previousKey !== updated.imageKey) await this.deleteQuestionImage(previousKey);
    await this.audit.log({
      actorId: user.id,
      action: 'question.update',
      entity: 'Question',
      entityId: questionId,
    });
    return this.toQuestion(updated);
  }

  async getQuestionImage(user: AuthUser, examId: string, questionId: string) {
    const exam = await this.findOwned(user, examId);
    return readPrivateImage(this.storage, this.requireQuestion(exam, questionId).imageKey);
  }

  async removeQuestion(user: AuthUser, examId: string, questionId: string): Promise<void> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    this.requireQuestion(exam, questionId);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, examId);
      const question = await tx.question.findUnique({ where: { id: questionId } });
      if (!question) throw new NotFoundException('Question not found');
      await tx.question.delete({ where: { id: questionId } });
      const remaining = await tx.question.findMany({
        where: { examId },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });
      await Promise.all(
        remaining.map((q, i) =>
          q.position === i + 1
            ? undefined
            : tx.question.update({ where: { id: q.id }, data: { position: i + 1 } }),
        ),
      );
      return question;
    });
    await this.deleteQuestionImage(removed.imageKey);
    await this.audit.log({
      actorId: user.id,
      action: 'question.delete',
      entity: 'Question',
      entityId: questionId,
    });
  }

  async reorder(user: AuthUser, examId: string, questionIds: string[]): Promise<ExamQuestionDto[]> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, examId);
      const questions = await tx.question.findMany({ where: { examId }, select: { id: true } });
      const existing = new Set(questions.map((q) => q.id));
      if (
        questionIds.length !== existing.size ||
        new Set(questionIds).size !== existing.size ||
        questionIds.some((id) => !existing.has(id))
      ) {
        throw new BadRequestException(
          'The list must contain every question of this exam exactly once',
        );
      }
      const updated = await Promise.all(
        questionIds.map((id, i) =>
          tx.question.update({ where: { id }, data: { position: i + 1 } }),
        ),
      );
      return updated.map((q) => this.toQuestion(q));
    });
  }

  /** Parses pasted question text. With `commit` false it only reports what would be imported. */
  async importQuestions(user: AuthUser, examId: string, input: ImportQuestionsInput) {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    // When the exam has a paper plan, every question gets the marks the plan sets for its type.
    const plan = paperPlanSchema.safeParse(exam.paperPlan).data;
    const parsed: ParsedQuestion[] = parseQuestionsTxt(input.text, {
      defaultMarks: input.defaultMarks,
    }).map((q) => (plan ? { ...q, marks: planMarksFor(plan, q.type) } : q));
    if (parsed.length === 0) {
      throw new BadRequestException(
        'No questions could be read from the text. Check the format guide.',
      );
    }
    const room = LIMITS.MAX_QUESTIONS_PER_EXAM - exam.questions.length;
    if (!input.commit) {
      return {
        committed: false,
        found: parsed.length,
        importable: Math.min(parsed.length, room),
        questions: parsed,
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, examId);
      const count = await tx.question.count({ where: { examId } });
      this.assertRoom(count, parsed.length);
      await tx.question.createMany({
        data: parsed.map((q, i) => ({
          examId,
          position: count + i + 1,
          type: q.type,
          body: q.body,
          options: q.options,
          correctOptions: q.correctOptions,
          marks: q.marks,
          // Multiple-answer questions give partial credit by default.
          partialCredit: q.type === 'MULTI',
          explanation: q.explanation || null,
        })),
      });
    });
    await this.audit.log({
      actorId: user.id,
      action: 'question.import',
      entity: 'Exam',
      entityId: examId,
      meta: { count: parsed.length },
    });
    return { committed: true, found: parsed.length, importable: parsed.length, questions: parsed };
  }

  // ------------------------------------------------------------- AI paper builder

  /**
   * Reads what an outside AI replied (pasted by the trainer) and, when `commit` is true, adds the
   * good questions to the end of the draft. The same reader the web uses runs here, so a check in
   * the browser and the import can never disagree. Marks come from the brief, not from the AI.
   * Only the brief is kept; the pasted answer is never stored or logged.
   */
  async aiImport(user: AuthUser, examId: string, input: AiImportInput): Promise<AiImportResult> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    const plan = paperPlanSchema.safeParse(exam.paperPlan).data;
    const parts = planParts(input.brief);
    const check = parseAiPaper(input.text, {
      brief: input.brief,
      expected: parts[Math.min(input.partIndex, parts.length - 1)],
      existingBodies: exam.questions.map((q) => q.body),
    });
    const room = LIMITS.MAX_QUESTIONS_PER_EXAM - exam.questions.length;
    await this.saveBrief(examId, input.brief);
    if (!input.commit) return { committed: false, room, check };

    if (check.fatal) throw new BadRequestException(check.fatal);
    if (check.valid.length === 0) {
      throw new BadRequestException('None of the questions in this answer can be imported');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, examId);
      const count = await tx.question.count({ where: { examId } });
      this.assertRoom(count, check.valid.length);
      await tx.question.createMany({
        data: check.valid.map((q, i) => ({
          examId,
          position: count + i + 1,
          ...this.questionData(q.input),
          // The paper plan, when there is one, decides the marks for each type.
          ...(plan ? { marks: planMarksFor(plan, q.input.type) } : {}),
        })),
      });
    });
    await this.audit.log({
      actorId: user.id,
      action: 'question.ai_import',
      entity: 'Exam',
      entityId: examId,
      // Counts only: never the pasted text.
      meta: { count: check.valid.length, skipped: check.problems.length, part: input.partIndex },
    });
    return { committed: true, room: room - check.valid.length, check };
  }

  /** Remembers the brief so the trainer can come back and build the prompt again. */
  async saveAiBrief(user: AuthUser, examId: string, brief: AiBrief): Promise<{ saved: true }> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    await this.saveBrief(examId, brief);
    return { saved: true };
  }

  private async saveBrief(examId: string, brief: AiBrief): Promise<void> {
    await this.prisma.exam.update({
      where: { id: examId },
      data: { aiBrief: brief as unknown as Prisma.InputJsonValue },
    });
  }

  // ------------------------------------------------------------------- logo

  async setLogo(
    user: AuthUser,
    examId: string,
    file: Buffer | undefined,
  ): Promise<{ hasLogo: true }> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    const image = validateImage(file, 'logo');

    const key = `logos/exams/${examId}/${randomUUID()}.${image.ext}`;
    await this.storage.put(key, file!, image.type);
    await this.prisma.exam.update({ where: { id: examId }, data: { logoKey: key } });
    if (exam.logoKey) await this.storage.delete(exam.logoKey);
    await this.audit.log({
      actorId: user.id,
      action: 'exam.logo.set',
      entity: 'Exam',
      entityId: examId,
    });
    return { hasLogo: true };
  }

  async getLogo(user: AuthUser, examId: string) {
    const exam = await this.findOwned(user, examId);
    const file = exam.logoKey ? await this.storage.get(exam.logoKey) : null;
    if (!file) throw new NotFoundException('No logo');
    return file;
  }

  async removeLogo(user: AuthUser, examId: string): Promise<void> {
    const exam = await this.findOwned(user, examId);
    this.assertDraft(exam);
    if (!exam.logoKey) return;
    await this.prisma.exam.update({ where: { id: examId }, data: { logoKey: null } });
    await this.storage.delete(exam.logoKey);
    await this.audit.log({
      actorId: user.id,
      action: 'exam.logo.remove',
      entity: 'Exam',
      entityId: examId,
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Other trainers' exams look like they do not exist. */
  private async findOwned(user: AuthUser, examId: string): Promise<ExamWithQuestions> {
    const exam = /^[0-9a-f-]{36}$/i.test(examId)
      ? await this.prisma.exam.findFirst({
          where: { id: examId, examinerId: user.id },
          include: { questions: { orderBy: { position: 'asc' } } },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private assertDraft(exam: Pick<Exam, 'status'>): void {
    if (exam.status !== 'DRAFT') {
      throw new ConflictException('This exam is no longer a draft and cannot be changed');
    }
  }

  private async lockDraft(tx: Prisma.TransactionClient, examId: string) {
    const [exam] = await tx.$queryRaw<Pick<Exam, 'status'>[]>`
      SELECT "status" FROM "Exam" WHERE "id" = ${examId}::uuid FOR UPDATE
    `;
    if (!exam) throw new NotFoundException('Exam not found');
    this.assertDraft(exam);
  }

  private async prepareQuestionImage(examId: string, input: QuestionInput, file?: Buffer) {
    if (!file) return;
    if (!input.imageAlt) throw new BadRequestException('Describe the question image');
    return this.storeQuestionImage(examId, file);
  }

  private async storeQuestionImage(examId: string, file: Buffer) {
    const image = validateImage(file, 'question image');
    const key = `questions/${examId}/${randomUUID()}.${image.ext}`;
    await this.storage.put(key, file, image.type);
    return key;
  }

  private async deleteQuestionImage(key: string | null | undefined) {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (err) {
      console.error('Could not delete question image', key, err);
    }
  }

  private assertRoom(current: number, adding: number): void {
    if (current + adding > LIMITS.MAX_QUESTIONS_PER_EXAM) {
      throw new BadRequestException(
        `An exam can have at most ${LIMITS.MAX_QUESTIONS_PER_EXAM} questions`,
      );
    }
  }

  private requireQuestion(exam: ExamWithQuestions, questionId: string): Question {
    const q = exam.questions.find((x) => x.id === questionId);
    if (!q) throw new NotFoundException('Question not found');
    return q;
  }

  private questionData(
    input: QuestionInput,
  ): Omit<Prisma.QuestionUncheckedCreateInput, 'examId' | 'position'> {
    const base = {
      type: input.type,
      body: input.body,
      markdown: input.markdown,
      marks: input.marks,
      explanation: input.explanation ?? null,
    };
    if (input.type === 'SUBJECTIVE') {
      return { ...base, options: [], correctOptions: [], rubric: input.rubric ?? null };
    }
    return {
      ...base,
      options: input.options,
      correctOptions: [...input.correctOptions].sort((a, b) => a - b),
      partialCredit: input.type === 'MULTI' ? input.partialCredit : false,
      rubric: null,
    };
  }

  private totalMarks(questions: { marks: number }[]): number {
    return Math.round(questions.reduce((sum, q) => sum + q.marks, 0) * 100) / 100;
  }

  private toQuestion(q: Question): ExamQuestionDto {
    return {
      id: q.id,
      position: q.position,
      type: q.type,
      body: q.body,
      markdown: q.markdown,
      imageAlt: q.imageAlt,
      options: q.options,
      correctOptions: q.correctOptions,
      marks: q.marks,
      partialCredit: q.partialCredit,
      explanation: q.explanation,
      rubric: q.rubric,
    };
  }

  private toSummary(exam: Exam, questions: { marks: number }[]): ExamSummaryDto {
    return {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      alwaysOpen: exam.alwaysOpen,
      durationMinutes: exam.durationMinutes,
      startsAt: exam.startsAt?.toISOString() ?? null,
      endsAt: exam.endsAt?.toISOString() ?? null,
      questionCount: questions.length,
      totalMarks: this.totalMarks(questions),
      createdAt: exam.createdAt.toISOString(),
      updatedAt: exam.updatedAt.toISOString(),
    };
  }

  private toDetail(exam: ExamWithQuestions): ExamDetailDto {
    return {
      ...this.toSummary(exam, exam.questions),
      description: exam.description,
      instructions: exam.instructions,
      passPercent: exam.passPercent,
      shuffleQuestions: exam.shuffleQuestions,
      shuffleOptions: exam.shuffleOptions,
      strikePolicy: exam.strikePolicy,
      maxStrikes: exam.maxStrikes,
      certificatesEnabled:
        certificateTemplateSchema.safeParse(exam.certificate ?? {}).data?.enabled ?? true,
      hasLogo: Boolean(exam.logoKey),
      nandivexHosted: exam.nandivexHosted,
      sponsoredCount: exam.sponsoredEmails.length,
      studentFeePaise: exam.studentFeePaise,
      alwaysOpen: exam.alwaysOpen,
      listedPublicly: exam.listedPublicly,
      catalogSummary: exam.catalogSummary,
      catalogTopics: exam.catalogTopics,
      catalogCategory: exam.catalogCategory,
      code: exam.code,
      publishedAt: exam.publishedAt?.toISOString() ?? null,
      aiBrief: (exam.aiBrief ?? null) as Record<string, unknown> | null,
      paperPlan: paperPlanSchema.safeParse(exam.paperPlan).data ?? null,
      questions: exam.questions.map((q) => this.toQuestion(q)),
    };
  }
}
